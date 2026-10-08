import { describe, expect, mock, test } from 'claude-code/testing'

import {
  advanceBaselines,
  fmtSpan,
  fmtTokens,
  limitLabel,
  limitTitle,
  modelMix,
  modelName,
  parseScan,
  parseVerb,
  sessionShare,
  sortLimits,
  weekday,
} from '../hooks/core'

const SURFACES = ['terminal', 'desktop'] as const
const T0 = Date.parse('2026-10-08T12:00:00Z')
const IN_2H10 = new Date(T0 + (2 * 60 + 10) * 60_000).toISOString()
const IN_4D3H = new Date(T0 + (4 * 24 + 3) * 3_600_000).toISOString()

const PANE = {
  plugin: 'usage-pane',
  component: 'Pane',
  requestId: 'usage-pane',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 62,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')

const measure = (five: number, seven: number, fiveResets = IN_2H10, usd = 1.5) => ({
  context: { window: 200_000, tokens: 62_000, percent: 31 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: seven, resetsAt: IN_4D3H },
    { kind: 'five_hour', percentUsed: five, resetsAt: fiveResets },
  ],
  cost: { usd },
  changed: ['rateLimits' as const],
})

describe('core', () => {
  test('a window counts the points it moved since the session began', () => {
    let b = advanceBaselines({}, [{ kind: 'five_hour', pct: 40, resetsAt: 'A' }])
    expect(sessionShare(b.five_hour)).toBe(0)
    b = advanceBaselines(b, [{ kind: 'five_hour', pct: 47.5, resetsAt: 'A' }])
    expect(sessionShare(b.five_hour)).toBe(7.5)
  })

  test('a reset carries the old period and starts the new one from zero', () => {
    let b = advanceBaselines({}, [{ kind: 'five_hour', pct: 90, resetsAt: 'A' }])
    b = advanceBaselines(b, [{ kind: 'five_hour', pct: 96, resetsAt: 'A' }])
    b = advanceBaselines(b, [{ kind: 'five_hour', pct: 3, resetsAt: 'B' }])
    expect(sessionShare(b.five_hour)).toBe(9)
    b = advanceBaselines(b, [{ kind: 'five_hour', pct: 5, resetsAt: 'B' }])
    expect(sessionShare(b.five_hour)).toBe(11)
  })

  test('a window that appears late starts at its first reading', () => {
    let b = advanceBaselines({}, [{ kind: 'five_hour', pct: 10, resetsAt: 'A' }])
    b = advanceBaselines(b, [
      { kind: 'five_hour', pct: 12, resetsAt: 'A' },
      { kind: 'seven_day_fable', pct: 30, resetsAt: 'W' },
    ])
    expect(sessionShare(b.seven_day_fable)).toBe(0)
    expect(sessionShare(undefined)).toBe(0)
  })

  test('windows are named as /status names them, in its order', () => {
    expect(limitTitle('five_hour')).toBe('Session (5h)')
    expect(limitTitle('seven_day')).toBe('Weekly')
    expect(limitTitle('seven_day_opus')).toBe('Opus weekly')
    expect(limitTitle('spend_limit')).toBe('Spend limit')
    expect(limitLabel('seven_day_opus')).toBe('7d opus')
    expect(sortLimits([{ kind: 'seven_day_opus', pct: 1, resetsAt: null }, { kind: 'seven_day', pct: 1, resetsAt: null }, { kind: 'five_hour', pct: 1, resetsAt: null }]).map(l => l.kind)).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_opus',
    ])
  })

  test('numbers format short', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(4_200)).toBe('4.2k')
    expect(fmtTokens(48_200)).toBe('48k')
    expect(fmtTokens(1_234_567)).toBe('1.2M')
    expect(fmtSpan(30_000)).toBe('<1m')
    expect(fmtSpan(12 * 60_000)).toBe('12m')
    expect(fmtSpan((2 * 60 + 10) * 60_000)).toBe('2h 10m')
    expect(fmtSpan((4 * 24 + 3) * 3_600_000)).toBe('4d 3h')
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelMix({ 'claude-opus-5-5': 82, 'claude-haiku-4-5-20251001': 18 })).toEqual([
      { name: 'Opus 5.5', pct: 82 },
      { name: 'Haiku 4.5', pct: 18 },
    ])
    expect(weekday('2026-10-06')).toBe('Tue')
  })

  test('the command takes open, close, or nothing to toggle', () => {
    expect(parseVerb('')).toBe('toggle')
    expect(parseVerb(' open ')).toBe('open')
    expect(parseVerb('hide')).toBe('close')
    expect(parseVerb('nope')).toBe(null)
  })

  test('scan output is checked before the card draws it', () => {
    expect(parseScan('not json')).toBe(null)
    expect(parseScan('{"today":{}}')).toBe(null)
    const ok = parseScan(
      JSON.stringify({ today: { tokens: 5, prompts: 1, sessions: 1 }, week: { tokens: 9, prompts: 2, sessions: 1 }, topModel: null, busiestDay: null, byDay: [] }),
    )
    expect(ok?.week.tokens).toBe(9)
  })
})

describe('pane', () => {
  test('limits, this session’s share and its totals', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.panes', () => ({ value: [] }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('session.usage', () => ({ value: { startedAt: T0 - 72 * 60_000, ...measure(40, 18, IN_2H10, 0) } }))
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    // No open on launch: only Flightdeck opens unasked
    expect(opened).toEqual([])

    await $.session.measure(measure(47.5, 19.2, IN_2H10, 3.41))

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const all = await texts(ui)
      expect(all).toContain('USAGE · 48% 5H · 19% WEEK')
      expect(all).toContain('■ limits')
      expect(all).toContain('LIMITS · account')
      expect(all).toContain('Session (5h)')
      expect(all).toContain('Weekly')
      // 5-hour first, as /status orders them, with the time left
      expect(all.indexOf('Session (5h)')).toBeLessThan(all.indexOf('Weekly'))
      expect(all).toContain('2h 10m')
      expect(all).toContain('4d 3h')
      expect(all).toContain('THIS SESSION · 1h 12m')
      expect(all).toContain('$3.41')
      expect(all).toContain('+7.5 pts')
      expect(all).toContain('+1.2 pts')
      expect(all).toContain('including any other sessions')
      await ui.unmount()
    }
  })

  test('tokens and turns add up from every model request', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 2_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 9_000 },
      }
    })
    await $.turn.start({ text: 'hello', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
    await $.turn.complete({ turnId: 't1', reason: 'end', text: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const all = await texts(ui)
    expect(all).toContain('10k in · 2.0k out · 50k cached')
    expect(all).toContain('prompts 1')
    expect(all).toContain('Opus 5.5 100%')
  })

  test('with no reading yet the limits card says so', async ($, on) => {
    mock.clock(on, { now: T0 })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const all = await texts(ui)
    expect(all).toContain('no reading yet')
    expect(all).toContain('USAGE')
    expect(all).not.toContain(' pts')
  })
})
