import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Baseline, Limit, Local, SessionTotals } from '../types'
import {
  advanceBaselines,
  EMPTY_SESSION,
  fmtSpan,
  fmtTokens,
  fmtUsd,
  gauge,
  levelColor,
  limitLabel,
  limitTitle,
  modelMix,
  modelName,
  parseScan,
  parseVerb,
  sessionShare,
  sortLimits,
  untilReset,
  weekday,
} from './core'

const PANE = 'usage-pane'
const TITLE = 'Usage'
// Docked width; matches Flightdeck's and Pinboard's so the dock doesn't jump between panes
const PANE_COLUMNS = 66
const TICK_MS = 60_000
// The LOCAL card rescans every this many ticks while the pane is open
const SCAN_EVERY_TICKS = 5
const SCAN_TIMEOUT_MS = 20_000

const limits = atom({ plugin: 'usage-pane', key: 'limits' } as const, [] as Limit[])
const baselines = atom({ plugin: 'usage-pane', key: 'baselines' } as const, {} as Record<string, Baseline>)
const session = atom({ plugin: 'usage-pane', key: 'session' } as const, EMPTY_SESSION)
const local = atom({ plugin: 'usage-pane', key: 'local' } as const, { stats: null, scannedAt: null, error: null } as Local)
const paneOpen = atom({ plugin: 'usage-pane', key: 'paneOpen' } as const, false)
const tick = atom({ plugin: 'usage-pane', key: 'tick' } as const, 0)

// Theme colour names (Flightdeck's palette), so light, dark and colour-blind themes all work
const C = {
  limits: 'claude',
  session: 'suggestion',
  local: 'success',
  dim: 'inactive',
  faint: 'subtle',
} as const

type Reading = {
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
  context: { percent?: number }
}

/** Takes one measurement: the windows, their baselines, the cost and the context fill. */
async function take($: EngineInterface, r: Reading) {
  const next: Limit[] = r.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt ?? null }))
  if (next.length > 0) {
    await update($, limits, () => next)
    await update($, baselines, old => advanceBaselines(old, next))
  }
  await update($, session, s => ({ ...s, costUsd: r.cost?.usd ?? s.costUsd, ctxPct: r.context.percent ?? s.ctxPct }))
}

/** Runs scan.py for the LOCAL card; a failure keeps the last figures and says why. */
async function rescan($: EngineInterface) {
  const script = `${$.plugin.root}/hooks/scan.py`
  try {
    const ran = await $.process.run(['python3', '-I', script], { timeoutMs: SCAN_TIMEOUT_MS })
    const stats = ran.exitCode === 0 ? parseScan(ran.stdout) : null
    const now = await $.clock.now()
    if (stats) await update($, local, () => ({ stats, scannedAt: now, error: null }))
    else await update($, local, l => ({ ...l, error: (ran.stderr || 'scan failed').trim().split('\n').at(-1) ?? 'scan failed' }))
  } catch (err) {
    await update($, local, l => ({ ...l, error: String(err) }))
  }
}

async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  void rescan($)
  return opened
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-pane',
      description: 'Show or hide the Usage pane: rate limits, this session’s share and local token stats',
      argumentHint: '[open|close]',
      immediate: true,
    })
    const u = await $.session.usage().catch(() => null)
    if (u) {
      await update($, session, s => ({ ...s, startedAt: s.startedAt ?? u.startedAt }))
      await take($, u)
    }
    // A reload keeps the pane up but starts the module over: re-read whether it is open
    const isUp = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
    await update($, paneOpen, () => isUp)
    // No open on launch: only Flightdeck opens unasked
    let ticks = 0
    $.clock.every(TICK_MS, () => {
      void (async () => {
        if (!(await read($, paneOpen))) return
        await update($, tick, n => n + 1)
        if (++ticks % SCAN_EVERY_TICKS === 0) await rescan($)
      })()
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, session, () => ({ ...EMPTY_SESSION, startedAt: now }))
      // Fresh baselines from the current figures: the cleared session starts at zero
      const current = await read($, limits)
      await update($, baselines, () => advanceBaselines({}, current))
    }
    return next(e)
  })

  on('command.run', { command: 'usage-pane' }, async ($, e) => {
    const verb = parseVerb(e.args)
    if (verb === null) return { text: 'Usage: /usage-pane [open|close]' }
    const isUp = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
    if (verb === 'close' || (verb === 'toggle' && isUp)) {
      await $.ui.close({ id: PANE })
      return {}
    }
    const opened = await openPane($)
    return opened.isPlaced ? {} : { text: `The Usage pane is not shown yet: ${opened.reason}` }
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    await update($, paneOpen, () => true)
    return opened
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneOpen, () => false)
    return closed
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await take($, e)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.text.trim() !== '') await update($, session, s => ({ ...s, prompts: s.prompts + 1 }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, session, s => ({ ...s, turns: s.turns + 1 }))
    return next(e)
  })

  // Every model request, the main thread's and each subagent's, adds what the API said it cost
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      await update($, session, s => ({
        ...s,
        inTok: s.inTok + u.input_tokens,
        outTok: s.outTok + u.output_tokens,
        cacheRead: s.cacheRead + u.cache_read_input_tokens,
        cacheWrite: s.cacheWrite + u.cache_creation_input_tokens,
        byModel: { ...s.byModel, [u.model]: (s.byModel[u.model] ?? 0) + u.input_tokens + u.cache_creation_input_tokens + u.output_tokens },
      }))
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const W = Math.max(40, e.props.bodyColumns)
    // A card's text area: the width less its border and one cell of padding each side
    const inner = W - 4
    await read($, tick)
    const now = await $.clock.now()
    const allLimits = sortLimits(await read($, limits))
    const base = await read($, baselines)
    const s: SessionTotals = await read($, session)
    const loc = await read($, local)

    // A card's first row: the upper-case label and subtitle in its accent, a dim state on the right
    const header = (accent: Color, label: string, subtitle: string, right: RenderChildren) => (
      <Box justifyContent="space-between" width={inner}>
        <Text color={accent} bold wrap="truncate">
          {`${label.toUpperCase()} · ${subtitle}`}
        </Text>
        {right}
      </Box>
    )
    // A label column, then the row's content
    const LABEL = 14
    const row = (label: string, content: RenderChildren) => (
      <Box flexDirection="row" width={inner}>
        <Box width={LABEL} flexShrink={0}>
          <Text dimColor wrap="truncate">
            {label}
          </Text>
        </Box>
        <Box flexShrink={1} flexGrow={1}>
          {content}
        </Box>
      </Box>
    )
    const meter = (pct: number, cells: number, color: Color) => {
      const g = gauge(pct, cells)
      return (
        <Text>
          <Text color={color}>{g.on}</Text>
          <Text color={C.faint}>{g.off}</Text>
        </Text>
      )
    }
    const rule = <Text color={C.faint}>{'─'.repeat(W)}</Text>

    // ---- LIMITS: one line per window, like Omarchy's agents panel
    const meterCells = Math.max(6, inner - LABEL - 14)
    const limitsCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.limits} paddingX={1} width={W}>
        {header(C.limits, 'limits', 'account', <Text dimColor>resets in</Text>)}
        {allLimits.length === 0 ? (
          <Text color={C.faint}>no reading yet: one comes with the next response</Text>
        ) : (
          allLimits.map(l =>
            row(
              limitTitle(l.kind),
              <Box flexDirection="row" justifyContent="space-between" width={inner - LABEL}>
                <Text>
                  {meter(l.pct, meterCells, levelColor(l.pct))}
                  <Text color={levelColor(l.pct)} bold>{` ${String(Math.round(l.pct)).padStart(3)}%`}</Text>
                </Text>
                <Text dimColor>{untilReset(l.resetsAt, now)}</Text>
              </Box>,
            ),
          )
        )}
      </Box>
    )

    // ---- THIS SESSION
    const elapsed = s.startedAt ? fmtSpan(Math.max(0, now - s.startedAt)) : '—'
    const mix = modelMix(s.byModel)
    const shareCells = 6
    const sessionCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.session} paddingX={1} width={W}>
        {header(C.session, 'this session', elapsed, <Text bold>{s.costUsd === null ? '' : fmtUsd(s.costUsd)}</Text>)}
        {allLimits.map(l => {
          const pts = sessionShare(base[l.kind])
          return row(
            `${limitLabel(l.kind)} used`,
            <Text>
              {meter(pts, shareCells, C.session)}
              <Text color={C.session} bold>{` +${pts.toFixed(1)} pts`}</Text>
              <Text dimColor>{` of ${Math.round(l.pct)}%`}</Text>
            </Text>,
          )
        })}
        {row(
          'tokens',
          <Text wrap="truncate">
            <Text bold>{fmtTokens(s.inTok + s.cacheWrite)}</Text>
            <Text dimColor> in · </Text>
            <Text bold>{fmtTokens(s.outTok)}</Text>
            <Text dimColor> out · </Text>
            <Text>{fmtTokens(s.cacheRead)}</Text>
            <Text dimColor> cached</Text>
          </Text>,
        )}
        {row(
          'turns',
          <Text wrap="truncate">
            <Text bold>{String(s.turns)}</Text>
            <Text dimColor> · prompts </Text>
            <Text bold>{String(s.prompts)}</Text>
            {s.ctxPct !== null && <Text dimColor> · ctx </Text>}
            {s.ctxPct !== null && meter(s.ctxPct, 4, levelColor(s.ctxPct))}
            {s.ctxPct !== null && <Text>{` ${Math.round(s.ctxPct)}%`}</Text>}
          </Text>,
        )}
        {mix.length > 0 &&
          row(
            'models',
            <Text wrap="truncate">
              {mix.slice(0, 3).map((m, i) => (
                <Text>
                  {i > 0 && <Text dimColor> · </Text>}
                  <Text>{m.name}</Text>
                  <Text dimColor>{` ${m.pct}%`}</Text>
                </Text>
              ))}
            </Text>,
          )}
        {allLimits.length > 0 && (
          <Text color={C.faint} wrap="wrap">
            pts = how far each window moved since this session began, including any other sessions running at the same time
          </Text>
        )}
      </Box>
    )

    // ---- LOCAL: every session on this machine, from the transcripts
    const st = loc.stats
    const ago = loc.scannedAt ? fmtSpan(Math.max(0, now - loc.scannedAt)) : null
    const localCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.local} paddingX={1} width={W}>
        {header(
          C.local,
          'local',
          'all sessions',
          <Box columnGap={1}>
            <Text dimColor>{ago ? `${ago} ago` : ''}</Text>
            <Button key="rescan" label="refresh" hotkey="r" plain dimColor onPress={() => rescan($)} />
          </Box>,
        )}
        {st ? (
          <Box flexDirection="column">
            {row(
              'today',
              <Text wrap="truncate">
                <Text bold>{fmtTokens(st.today.tokens)}</Text>
                <Text dimColor> tok · </Text>
                <Text>{String(st.today.prompts)}</Text>
                <Text dimColor> prompts · </Text>
                <Text>{String(st.today.sessions)}</Text>
                <Text dimColor> sessions</Text>
              </Text>,
            )}
            {row(
              'this week',
              <Text wrap="truncate">
                <Text bold>{fmtTokens(st.week.tokens)}</Text>
                <Text dimColor> tok · </Text>
                <Text>{String(st.week.prompts)}</Text>
                <Text dimColor> prompts · </Text>
                <Text>{String(st.week.sessions)}</Text>
                <Text dimColor> sessions</Text>
              </Text>,
            )}
            {row(
              'by day',
              <Text wrap="truncate">
                {(() => {
                  const max = Math.max(1, ...st.byDay.map(d => d.tokens))
                  const bars = '▁▂▃▄▅▆▇█'
                  return st.byDay.map(d => (
                    <Text color={C.local}>{d.tokens > 0 ? bars[Math.min(7, Math.floor((d.tokens / max) * 7.999))]! : ' '}</Text>
                  ))
                })()}
                {st.busiestDay && <Text dimColor>{`  busiest ${weekday(st.busiestDay)}`}</Text>}
              </Text>,
            )}
            {st.topModel && row('mostly', <Text>{modelName(st.topModel)}</Text>)}
          </Box>
        ) : (
          <Text color={C.faint}>{loc.error ? `local stats unavailable: ${loc.error}` : 'scanning transcripts…'}</Text>
        )}
        {st && loc.error && <Text color={C.faint}>{`last scan failed: ${loc.error}`}</Text>}
      </Box>
    )

    const five = allLimits.find(l => /five/i.test(l.kind))
    const seven = allLimits.find(l => /^seven[_ -]?days?$/i.test(l.kind))
    const legend = [
      { label: 'limits', color: C.limits },
      { label: 'session', color: C.session },
      { label: 'local', color: C.local },
    ]

    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center">
          <Text bold wrap="truncate">
            <Text>USAGE</Text>
            {five && <Text color={C.dim}> · </Text>}
            {five && <Text color={levelColor(five.pct)}>{`${Math.round(five.pct)}%`}</Text>}
            {five && <Text> 5H</Text>}
            {seven && <Text color={C.dim}> · </Text>}
            {seven && <Text color={levelColor(seven.pct)}>{`${Math.round(seven.pct)}%`}</Text>}
            {seven && <Text> WEEK</Text>}
          </Text>
        </Box>
        <Box justifyContent="center" columnGap={2}>
          {legend.map(l => (
            <Text>
              <Text color={l.color}>■</Text>
              <Text dimColor>{` ${l.label}`}</Text>
            </Text>
          ))}
        </Box>
        {[limitsCard, sessionCard, localCard].map((card, i) => (
          <Box flexDirection="column">
            {i > 0 && rule}
            {card}
          </Box>
        ))}
      </Box>
    )
  })
}
