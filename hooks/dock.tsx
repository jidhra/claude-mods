import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, On, RenderElement, RenderInput, Timer } from 'claude-code'

import type { DockHelper, DockHelperModel, DockMission } from '../types'
import {
  HELPER_MODELS,
  applyHelperProgress,
  SIZES,
  badge,
  capMessage,
  cardsPerRow,
  clampPercent,
  clock,
  counts,
  filledCells,
  helperCaption,
  helperModelAlias,
  helperModelFrom,
  infoLine,
  initials,
  isComplete,
  isLive,
  isNudge,
  jobName,
  missionEnd,
  missionPercent,
  missionSpans,
  newHelper,
  newMission,
  patchHelper,
  queueHelpers,
  nudgeText,
  parseSize,
  sizeFrom,
  splitInstruction,
  stepSize,
  summary,
  sweepHead,
} from './dock-logic'

const PANE = 'agent-dock'
const TITLE = 'Agent Dock'
const COMMAND = 'dock'
const PROGRESS_TOOL = 'mcp__clean-view__report_progress'
const PLAN_TOOL = 'mcp__clean-view__plan_steps'
const SIZE_KEY = 'dockSize'
const HELPER_MODEL_KEY = 'panel.helperModel'
const PANE_COLUMNS = 76
const TICK_MS = 200
const BAD_SIZE = 'Team Size is a whole number from 1 to 10, e.g. /dock 6.'
const TOO_NARROW = 'The window is too narrow to show the Agent Dock. Widen it or watch the status bar.'
const WORDMARK = 'A G E N T   D O C K'
const SEAT_COLORS = ['claude', 'warning', 'success', 'suggestion', 'permission', 'remember', 'autoAccept', 'planMode', 'ide', 'error']

const sizeAtom = atom({ plugin: 'clean-view', key: 'dockSize' } as const, 1)
const helperModelAtom = atom({ plugin: 'clean-view', key: 'dockHelperModel' } as const, 'same')
const missionAtom = atom({ plugin: 'clean-view', key: 'dockMission' } as const, null)
const tickAtom = atom({ plugin: 'clean-view', key: 'dockTick' } as const, 0)
const sessionModelAtom = atom({ plugin: 'clean-view', key: 'dockSessionModel' } as const, null)
const sessionEffortAtom = atom({ plugin: 'clean-view', key: 'dockSessionEffort' } as const, null)

type Engine = EngineInterface

// Module state that need not survive a reload.
let ticker: Timer | undefined
let lastPrompt = ''
let lastLiveCount = -1

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Reads the session's model and effort, for the Helpers caption and the model rewrite. */
async function refreshSessionModel($: Engine) {
  let model: string | null = null
  let effort: string | null = null
  try {
    model = asText(await $.session.model())
  } catch {
    // Falls back to /config and settings below.
  }
  try {
    const rows: readonly ConfigRow[] = await $.config.list()
    const engineRows = rows.filter(row => row.provider.plugin === 'engine')
    model ??= asText(engineRows.find(row => /^model$/i.test(row.key) || /^model$/i.test(row.label))?.value)
    effort = asText(engineRows.find(row => /effort/i.test(row.key) || /effort/i.test(row.label))?.value)
  } catch {
    // Settings are the fallback.
  }
  if (effort === null) {
    try {
      effort = asText(asRecord(await $.settings.read()).effortLevel)
    } catch {
      // Left unknown; the caption says "your effort".
    }
  }
  await update($, sessionModelAtom, () => model)
  await update($, sessionEffortAtom, () => effort)
}

async function isPaneOpen($: Engine): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE)
  } catch {
    return false
  }
}

/** Writes the live helper count where the status line reads it. */
async function writeAgentsNow($: Engine, mission: DockMission | null) {
  const live = mission === null ? 0 : counts(mission.helpers).working
  if (live === lastLiveCount) {
    return
  }
  lastLiveCount = live
  try {
    const home = await $.env.get('HOME')
    if (home === undefined || home === '') {
      return
    }
    const id = await $.session.id()
    await $.fs.write(`${home}/.claude/ai-employee-kit-data/agents-now/${id}.json`, JSON.stringify({ count: live }) + '\n')
  } catch {
    // The status line just shows the last count it read.
  }
}

/** Keeps the status-bar badge, the agents-now file and the animation clock in step with the mission. */
async function sync($: Engine, mission: DockMission | null) {
  const shouldTick = isLive(mission)
  if (shouldTick && ticker === undefined) {
    ticker = $.clock.every(TICK_MS, () => {
      void update($, tickAtom, n => (n + 1) % 1_000_000).catch(() => undefined)
    })
  } else if (!shouldTick && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }

  const isOpen = await isPaneOpen($)
  $.ui.status(!isOpen && mission !== null && mission.helpers.length > 0 ? badge(counts(mission.helpers)) : undefined)
  await writeAgentsNow($, mission)
}

async function change($: Engine, fn: (mission: DockMission) => DockMission | null) {
  const next = await update($, missionAtom, mission => (mission === null ? null : fn(mission)))
  await sync($, next)

  return next
}

async function ensureMission($: Engine): Promise<DockMission> {
  const mission = await read($, missionAtom)
  if (mission !== null && !mission.isStopped) {
    return mission
  }
  const fresh = newMission(jobName(lastPrompt), await $.clock.now())
  await update($, missionAtom, () => fresh)

  return fresh
}

async function setSize($: Engine, size: number) {
  await update($, sizeAtom, () => size)
  try {
    await $.store.set(SIZE_KEY, size)
  } catch {
    // Remembering is best effort; the session keeps the size.
  }
}

async function setHelperModel($: Engine, choice: DockHelperModel) {
  await update($, helperModelAtom, () => choice)
  try {
    await $.store.set(HELPER_MODEL_KEY, choice)
  } catch {
    // Remembering is best effort.
  }
  await refreshSessionModel($)
}

async function openPane($: Engine) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  if (!opened.isPlaced) {
    $.ui.toast(TOO_NARROW)
  }
  await refreshSessionModel($)
  await sync($, await read($, missionAtom))
}

async function togglePane($: Engine) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await sync($, await read($, missionAtom))
  } else {
    await openPane($)
  }
}

/** Marks every unfinished helper stuck: Esc, or a turn that died with helpers still out. */
function stopHelpers(mission: DockMission, now: number): DockMission {
  return {
    ...mission,
    isStopped: true,
    helpers: mission.helpers.map(helper =>
      helper.status === 'queued' || helper.status === 'working' ? { ...helper, status: 'stuck', finishedAt: now } : helper,
    ),
  }
}

export function registerAgentDock(on: On) {
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    try {
      await update($, sizeAtom, () => 1)
      const stored = await $.store.get(SIZE_KEY)
      await update($, sizeAtom, () => sizeFrom(stored))
      const helperModel = await $.store.get(HELPER_MODEL_KEY)
      await update($, helperModelAtom, () => helperModelFrom(helperModel))
    } catch {
      // Starts at size 1, helpers on the same model.
    }

    await $.command.register({
      name: COMMAND,
      description: 'Open or fold the Agent Dock; /dock 6 sets the Team Size',
      argumentHint: '[1-10] | helpers fast|same|stepdown',
    })

    lastLiveCount = -1
    await sync($, await read($, missionAtom))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      const arg = e.args.trim()
      if (arg === '') {
        void (async () => {
          try {
            await togglePane($)
          } catch {
            $.ui.toast(TOO_NARROW)
          }
        })()

        return { text: 'Agent Dock toggled.' }
      }

      const helpers = /^helpers?\s+(.+)$/i.exec(arg)
      if (helpers !== null) {
        const choice = helperModelFrom(helpers[1])
        void setHelperModel($, choice)

        return { text: `Helpers: ${HELPER_MODELS.find(option => option.value === choice)!.label}.` }
      }

      const size = parseSize(arg)
      if (size === null) {
        return { text: BAD_SIZE }
      }
      void setSize($, size)

      return { text: `Team Size is ${size}. ${infoLine(size)}.` }
    } catch {
      return { text: 'Agent Dock could not run that. Try /dock or /dock 6.' }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (text === '' || text.startsWith('/') || e.origin?.kind === 'plugin' || isNudge(text)) {
      return next(e)
    }
    const size = await read($, sizeAtom)
    if (size <= 1) {
      return next(e)
    }

    return next({ ...e, context: [...(e.context ?? []), splitInstruction(size)] })
  }).catch(($, e, next) => next(e))

  on('turn.start', { text: /^/ }, async ($, e, next) => {
    const text = e.text.trim()
    if (text !== '' && !text.startsWith('/') && !isNudge(text)) {
      lastPrompt = text
      const fresh = newMission(jobName(text), await $.clock.now())
      await update($, missionAtom, () => fresh)
      await sync($, fresh)
      void refreshSessionModel($)
    }

    return next(e)
  })

  // Queued cards appear as soon as Claude writes the Agent calls, before any runs.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const content = e.message.content
      if (Array.isArray(content) && content.some(block => block.type === 'tool_use')) {
        const now = await $.clock.now()
        await ensureMission($)
        await change($, mission => queueHelpers(mission, content, now))
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const id = e.tool_use_id
    const size = await read($, sizeAtom)
    const mission = await ensureMission($)

    if (size > 1 && mission.agentCalls >= size) {
      await change($, current => ({ ...current, helpers: current.helpers.filter(helper => helper.id !== id) }))

      return { deny: capMessage(size) }
    }

    const now = await $.clock.now()
    await change($, current => {
      const known = current.helpers.some(helper => helper.id === id)
      const helpers = known
        ? current.helpers.map(helper =>
            helper.id === id ? { ...helper, name: newHelper(id, e.description, 'working', now).name, status: 'working' as const, startedAt: now } : helper,
          )
        : [...current.helpers, newHelper(id, e.description, 'working', now)]

      return { ...current, agentCalls: current.agentCalls + 1, helpers }
    })

    let call = e
    if (size > 1 && e.model === undefined) {
      const alias = helperModelAlias(await read($, helperModelAtom), await read($, sessionModelAtom))
      if (alias !== null) {
        call = { ...e, model: alias }
      }
    }

    const ran = await next(call)
    const end = await $.clock.now()

    if (ran.deny !== undefined) {
      await change($, current => ({
        ...current,
        agentCalls: Math.max(0, current.agentCalls - 1),
        helpers: current.helpers.filter(helper => helper.id !== id),
      }))
    } else if (ran.isError === true) {
      await change($, current => patchHelper(current, id, helper => ({ ...helper, status: 'stuck', finishedAt: end })))
    } else {
      await change($, current =>
        patchHelper(current, id, helper =>
          helper.status === 'stuck' ? helper : { ...helper, status: 'done', percent: 100, hasReported: true, finishedAt: end },
        ),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Helpers report here: this hook is registered before Clean View's, so it answers first.
  on('tool.call', { tool: PROGRESS_TOOL, agentId: /./ }, async ($, e) => {
    const input = e as unknown as { task?: unknown; percent?: unknown; agentId?: string }
    const percent = clampPercent(input.percent)
    const agentId = String(input.agentId ?? '')
    const task = String(input.task ?? '')

    await change($, mission => applyHelperProgress(mission, agentId, task, percent))

    return { result: `Progress noted: ${percent}%.` }
  }).catch(() => ({ result: 'Progress noted.' }))

  on('tool.call', { tool: PLAN_TOOL, agentId: /./ }, async () => ({
    result: 'Helpers skip the plan. Just call report_progress as you work.',
  })).catch(() => ({ result: 'Helpers skip the plan. Just call report_progress as you work.' }))

  on('turn.complete', { turnId: /^/ }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const mission = await read($, missionAtom)
    if (mission === null) {
      return next(e)
    }
    const now = await $.clock.now()

    if (e.isAborted || e.reason === 'aborted' || e.reason === 'error') {
      if (mission.helpers.length === 0) {
        await change($, () => null)
      } else {
        await change($, current => stopHelpers(current, now))
      }

      return next(e)
    }

    const size = await read($, sizeAtom)
    if (size > 1 && !mission.isNudged && mission.agentCalls < size && e.reason === 'answer') {
      const nudge = nudgeText(mission.agentCalls, size)
      await change($, current => ({ ...current, isNudged: true }))
      $.clock.after(0, () => {
        void $.prompt.submit({ text: nudge }).catch(() => undefined)
      })

      return next(e)
    }

    if (mission.helpers.length === 0) {
      await change($, () => null)
    } else {
      await change($, current => stopHelpers(current, now))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawDock($, e))
}

/** The dock's pane. */
async function drawDock($: Engine, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const size = await read($, sizeAtom)
  const mission = await read($, missionAtom)
  const helperModel = await read($, helperModelAtom)
  const sessionModel = await read($, sessionModelAtom)
  const sessionEffort = await read($, sessionEffortAtom)
  const live = isLive(mission)
  const tick = live ? await read($, tickAtom) : 0
  const now = await $.clock.now()
  const width = Math.max(30, e.props.bodyColumns)

  // ---- masthead: the wordmark fades coral to gold
  const letters = WORDMARK.split('')
  const wordmark = letters.map((letter, i) => (
    <Text key={`wm-${i}`} color={i < letters.length / 2 ? 'claude' : 'warning'} bold>
      {letter}
    </Text>
  ))
  let state
  if (live) {
    state = (
      <Text color="success" bold dimColor={Math.floor(tick / 4) % 2 === 1}>
        ● L I V E
      </Text>
    )
  } else if (isComplete(mission)) {
    state = <Text color="warning">C O M P L E T E</Text>
  } else {
    state = <Text dimColor>S T A N D I N G   B Y</Text>
  }
  const masthead = (
    <Box key="masthead" flexDirection="row" justifyContent="space-between" width={width}>
      <Box flexDirection="row">
        <Text color="claude" bold>
          {'◆  '}
        </Text>
        {wordmark}
      </Box>
      {state}
    </Box>
  )
  const rule = (
    <Text key="rule" dimColor>
      {'─'.repeat(width)}
    </Text>
  )

  // ---- Team Size: a 10-segment control; ‹ › step by one
  const segments = SIZES.map(n =>
    n === size ? (
      <Text key={`size-${n}`} backgroundColor="claude" color="inverseText" bold>
        {` ${n} `}
      </Text>
    ) : (
      <Button key={`size-${n}`} plain label={` ${n} `} hotkey={n === 10 ? '0' : String(n)} onPress={() => setSize($, n)} />
    ),
  )
  const sizeRow = (
    <Box key="team-size" flexDirection="row" flexWrap="wrap">
      <Box width={18} flexShrink={0}>
        <Text dimColor>T E A M  S I Z E</Text>
      </Box>
      <Button key="size-down" plain label=" ‹ " onPress={() => setSize($, stepSize(size, -1))} />
      {segments}
      <Button key="size-up" plain label=" › " onPress={() => setSize($, stepSize(size, 1))} />
    </Box>
  )
  const info = (
    <Text key="info" dimColor wrap="truncate-end">
      {infoLine(size)}
    </Text>
  )

  // ---- Helpers: which model the helpers run on
  const helperOptions = HELPER_MODELS.map(option =>
    option.value === helperModel ? (
      <Text key={`helpers-${option.value}`} backgroundColor="claude" color="inverseText" bold>
        {` ${option.label} `}
      </Text>
    ) : (
      <Button key={`helpers-${option.value}`} plain label={` ${option.label} `} onPress={() => setHelperModel($, option.value)} />
    ),
  )
  const helpersRow = (
    <Box key="helpers" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexWrap="wrap">
        <Box width={18} flexShrink={0}>
          <Text dimColor>H E L P E R S</Text>
        </Box>
        {helperOptions}
      </Box>
      <Text dimColor wrap="truncate-end">
        {helperCaption(helperModel, sessionModel, sessionEffort)}
      </Text>
    </Box>
  )

  const top = [masthead, rule, sizeRow, info, helpersRow]

  // ---- idle: one seat per team member
  if (mission === null || mission.helpers.length === 0) {
    const seats = Array.from({ length: size }, (_, i) => (
      <Text key={`seat-${i}`} color={SEAT_COLORS[i % SEAT_COLORS.length]}>
        {'● '}
      </Text>
    ))

    return (
      <Box flexDirection="column" width={width}>
        {top}
        <Box key="seats" flexDirection="row" marginTop={1}>
          {seats}
        </Box>
        <Text key="standing-by">Your team of {size} is standing by</Text>
        <Text key="send" dimColor>
          {size <= 1 ? 'Send a request and Claude decides how many helpers to use.' : `Send a request and it splits across ${size} helpers.`}
        </Text>
      </Box>
    )
  }

  // ---- mission bar
  const percent = missionPercent(mission.helpers)
  const elapsed = clock(missionEnd(mission, now) - mission.startedAt)
  const spans = missionSpans(mission.helpers, width)
  const rest = Math.max(0, width - spans.done - spans.working)
  const half = Math.ceil(spans.done / 2)
  const shimmer = live && tick % 6 < 3
  const c = counts(mission.helpers)
  const missionRows = [
    <Box key="mission" flexDirection="row" justifyContent="space-between" width={width} marginTop={1}>
      <Box flexDirection="row" flexShrink={1} gap={1}>
        <Text dimColor>M I S S I O N</Text>
        <Text bold wrap="truncate-end">
          {mission.job}
        </Text>
      </Box>
      <Text>
        {`${percent}%   ${elapsed}`}
      </Text>
    </Box>,
    <Box key="mission-bar" flexDirection="row">
      <Text color="claude">{'━'.repeat(half)}</Text>
      <Text color="warning">{'━'.repeat(spans.done - half)}</Text>
      <Text color="success" dimColor={shimmer}>
        {'━'.repeat(spans.working)}
      </Text>
      <Text dimColor>{'─'.repeat(rest)}</Text>
    </Box>,
    <Box key="counts" flexDirection="row" gap={4}>
      <Text color="success">● {c.working} working</Text>
      <Text dimColor>○ {c.queued} queued</Text>
      <Text color="claude">✓ {c.done} done</Text>
      <Text color={c.stuck > 0 ? 'error' : 'inactive'}>✕ {c.stuck} stuck</Text>
    </Box>,
  ]

  // ---- cards
  const perRow = cardsPerRow(width)
  const cardWidth = Math.floor((width - (perRow - 1)) / perRow)
  const meterWidth = Math.max(6, cardWidth - 4 - 5)
  const nameWidth = Math.max(6, cardWidth - 4 - 3 - 6)
  const cards = mission.helpers.map((helper, index) => drawCard($, e, helper, index, { cardWidth, meterWidth, nameWidth, tick, now }))
  const rows = []
  for (let i = 0; i < cards.length; i += perRow) {
    rows.push(
      <Box key={`cards-${i}`} flexDirection="row" gap={1}>
        {cards.slice(i, i + perRow)}
      </Box>,
    )
  }

  const done = isComplete(mission)
    ? [
        <Box key="summary" borderStyle="round" borderColor="success" paddingX={1} width={width} marginTop={1}>
          <Text color="success" wrap="truncate-end">
            ✓ {summary(mission, now)}
          </Text>
        </Box>,
      ]
    : []

  return (
    <Box flexDirection="column" width={width}>
      {top}
      {missionRows}
      <Box key="cards" flexDirection="column" marginTop={1}>
        {rows}
      </Box>
      {done}
    </Box>
  )
}

type CardLayout = { cardWidth: number; meterWidth: number; nameWidth: number; tick: number; now: number }

function drawCard($: Engine, e: RenderInput<'Pane'>, helper: DockHelper, index: number, layout: CardLayout): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const { cardWidth, meterWidth, nameWidth, tick, now } = layout
  const isQueued = helper.status === 'queued'
  const isStuck = helper.status === 'stuck'
  const timer = helper.startedAt === null ? '0:00' : clock((helper.finishedAt ?? now) - helper.startedAt)
  const name = helper.name.length > nameWidth ? helper.name.slice(0, nameWidth - 1) + '…' : helper.name.padEnd(nameWidth)

  let meter
  let label
  if (helper.status === 'done') {
    meter = <Text color="claude">{'━'.repeat(meterWidth)}</Text>
    label = '100%'
  } else if (isStuck) {
    const filled = filledCells(helper.percent, meterWidth)
    meter = (
      <Text>
        <Text color="error">{'━'.repeat(filled)}</Text>
        <Text dimColor>{'─'.repeat(meterWidth - filled)}</Text>
      </Text>
    )
    label = 'stuck'
  } else if (helper.status === 'working' && helper.hasReported) {
    const filled = filledCells(helper.percent, meterWidth)
    meter = (
      <Text>
        <Text color="success">{'━'.repeat(filled)}</Text>
        <Text dimColor>{'─'.repeat(meterWidth - filled)}</Text>
      </Text>
    )
    label = `${helper.percent}%`
  } else if (helper.status === 'working') {
    const head = sweepHead(tick + index * 3, meterWidth)
    meter = (
      <Text>
        {Array.from({ length: meterWidth }, (_, i) =>
          i <= head && i > head - 4 ? (
            <Text key={`sw-${i}`} color="success">
              ━
            </Text>
          ) : (
            <Text key={`sw-${i}`} dimColor>
              ─
            </Text>
          ),
        )}
      </Text>
    )
    label = '…'
  } else {
    meter = <Text dimColor>{'─'.repeat(meterWidth)}</Text>
    label = 'queued'
  }

  return (
    <Box
      key={`card-${helper.id}`}
      flexDirection="column"
      borderStyle="round"
      borderColor={isStuck ? 'error' : 'subtle'}
      hover={{ borderColor: 'claude' }}
      width={cardWidth}
      paddingX={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text backgroundColor={isQueued ? 'inactive' : SEAT_COLORS[index % SEAT_COLORS.length]} color="inverseText" bold>
          {initials(helper.name)}
        </Text>
        <Text bold={!isQueued} dimColor={isQueued}>
          {name}
        </Text>
        <Text dimColor>{timer}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text>{'   '}</Text>
        {meter}
        <Text dimColor={isQueued}>{label}</Text>
      </Box>
    </Box>
  )
}
