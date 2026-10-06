import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  applyHelperProgress,
  helperModelAlias,
  newHelper,
  newMission,
  parseSize,
  queueHelpers,
  stepDownEffort,
  stepDownModel,
  stepSize,
} from '../hooks/dock-logic'

const PLAN = 'mcp__clean-view__plan_steps'
const PANE = { plugin: 'clean-view', component: 'Pane', requestId: 'agent-dock' } as const
const PANE_PROPS = {
  title: 'Agent Dock',
  isFocused: false,
  bodyColumns: 76,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

type Seen = { clock: MockClock; agentCalls: { model?: string }[]; submitted: string[]; contexts: (readonly string[] | undefined)[]; status: (string | undefined)[] }

/** Starts a session with a mocked clock and store; helpers' Agent calls answer "ok". */
async function start($: Engine, on: On, stored: Record<string, unknown> = {}): Promise<Seen> {
  const panes = new Set<string>()
  const seen: Seen = { clock: mock.clock(on, { now: 1_000_000 }), agentCalls: [], submitted: [], contexts: [], status: [] }
  mock.store(on, stored)
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Agent') {
      seen.agentCalls.push({ model: e.model })
    }

    return { result: 'ok' }
  })
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__clean-view__${e.name}` } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => {
    if (e.origin.kind === 'plugin') {
      seen.submitted.push(e.text)
    } else {
      seen.contexts.push(e.context)
    }

    return { text: e.text, context: e.context }
  })
  on('ui.open', async (_$, e) => {
    panes.add(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async (_$, e) => {
    panes.delete(e.id)

    return { value: undefined }
  })
  on('ui.panes', async () => ({
    value: [...panes].map(id => ({ id, title: 'Agent Dock', isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.status', async (_$, e) => {
    seen.status.push(e.text)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  return seen
}

async function dock($: Engine, args: string) {
  return $.command.run({ command: 'dock', args, ...COMMAND })
}

async function request($: Engine, text = 'Research bakery pricing for five shops') {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text, turnId: 't1' })
  await $.tool.call({ tool: PLAN, steps: ['Split the work', 'Combine the results'] })
}

async function agent($: Engine, description: string, model?: 'haiku' | 'sonnet' | 'opus' | 'fable') {
  return $.tool.call({ tool: 'Agent', description, prompt: `Do: ${description}`, ...(model ? { model } : {}) })
}

async function paneTexts($: Engine) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()

  return texts
}

describe('Team Size', () => {
  test('1. parseSize takes 1 to 10 and nothing else', async () => {
    expect(parseSize('10')).toBe(10)
    expect(parseSize(' 7 ')).toBe(7)
    for (const bad of ['0', '11', 'abc', '2.5']) {
      expect(parseSize(bad)).toBe(null)
    }
  })

  test('2. a saved size of 7 comes back in a new session', async ($, on) => {
    await start($, on, { dockSize: 7 })
    expect(await paneTexts($)).toContain('Your team of 7 is standing by')
  })

  test('9. stepping holds the size between 1 and 10', async () => {
    expect(stepSize(10, 1)).toBe(10)
    expect(stepSize(1, -1)).toBe(1)
    expect(stepSize(5, 1)).toBe(6)
  })

  test('/dock 6 sets the size, and a bad number says what to type', async ($, on) => {
    await start($, on)
    expect((await dock($, '6')).text).toContain('Team Size is 6')
    expect((await dock($, '11')).text).toBe('Team Size is a whole number from 1 to 10, e.g. /dock 6.')
    expect(await paneTexts($)).toContain('Your team of 6 is standing by')
  })
})

test('3. at size 5 a request carries the exactly-5 instruction; at size 1 nothing', async ($, on) => {
  const seen = await start($, on)
  await $.prompt.submit({ text: 'Plan a party', origin: { kind: 'composer' }, wait: false })
  expect(seen.contexts.at(-1) ?? []).toHaveLength(0)

  await dock($, '5')
  await $.prompt.submit({ text: 'Plan a party', origin: { kind: 'composer' }, wait: false })
  expect((seen.contexts.at(-1) ?? []).join('\n')).toContain('exactly 5 independent pieces')
})

test('4. the 6th Agent call at size 5 is denied', async ($, on) => {
  await start($, on)
  await dock($, '5')
  await request($)
  for (let i = 1; i <= 5; i += 1) {
    expect((await agent($, `Price check: shop ${i}`)).deny).toBeUndefined()
  }
  const sixth = await agent($, 'Price check: shop 6')
  expect(String(sixth.deny ?? sixth.text)).toBe('Team Size is 5: this request already has 5 helpers. Finish with the helpers you have.')
})

test('5. a request that used 3 of 10 gets exactly one nudge', async ($, on) => {
  const seen = await start($, on, { dockSize: 10 })
  await request($)
  for (const name of ['Panera', 'Crumbl', 'Nothing Bundt']) {
    await agent($, `Price check: ${name}`)
  }
  await $.turn.complete({ answer: 'Done', durationMs: 1000, reason: 'answer', isAborted: false, turnId: 't1' })
  await seen.clock.advance(1)
  await $.turn.complete({ answer: 'Done again', durationMs: 1000, reason: 'answer', isAborted: false, turnId: 't2' })

  const nudges = seen.submitted.filter(text => text.startsWith('You used 3 of 10 helpers'))
  expect(nudges).toHaveLength(1)
})

test('6. Agent calls show queued, then working, then done cards; a report moves one meter', async ($, on) => {
  await start($, on)
  await dock($, '3')
  await request($)

  // Claude writes three Agent calls: three queued cards before any runs.
  let queuedMission = newMission('Research bakery pricing', 0)
  queuedMission = queueHelpers(
    queuedMission,
    ['Panera', 'Crumbl', 'Insomnia'].map((name, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: 'Agent', input: { description: `Price check: ${name}` } })),
    0,
  )
  expect(queuedMission.helpers.map(helper => helper.status)).toEqual(['queued', 'queued', 'queued'])

  for (const name of ['Panera', 'Crumbl', 'Insomnia']) {
    await agent($, `Price check: ${name}`)
  }
  const done = await paneTexts($)
  expect(done.filter(text => text === '100%')).toHaveLength(3)

  // A helper's report: the same matching the hook runs on report_progress.
  let mission = newMission('Research bakery pricing', 0)
  mission = { ...mission, helpers: [newHelper('a', 'Price check: Panera', 'working', 0), newHelper('b', 'Price check: Crumbl', 'working', 0)] }
  mission = applyHelperProgress(mission, 'agent-7', 'Price check: Crumbl', 60)
  expect(mission.helpers.find(helper => helper.id === 'b')?.percent).toBe(60)
  expect(mission.helpers.find(helper => helper.id === 'b')?.agentId).toBe('agent-7')
  mission = applyHelperProgress(mission, 'agent-7', 'whatever', 75)
  expect(mission.helpers.find(helper => helper.id === 'b')?.percent).toBe(75)
})

test('7. all done shows the summary line', async ($, on) => {
  await start($, on)
  await dock($, '3')
  await request($, 'Research bakery pricing')
  for (const name of ['Panera', 'Crumbl', 'Insomnia']) {
    await agent($, `Price check: ${name}`)
  }
  const texts = await paneTexts($)
  expect(texts.join('|')).toMatch(/3 agents finished Research bakery pricing in \d+s/)
})

test('8. /dock folds the pane to a badge and opens it again', async ($, on) => {
  const seen = await start($, on)
  await dock($, '2')
  await request($)
  await agent($, 'Price check: Panera')

  await dock($, '')
  await seen.clock.advance(1)
  expect(seen.status.at(-1)).toBeUndefined()

  await dock($, '')
  await seen.clock.advance(1)
  expect(seen.status.at(-1)).toBe('◆ 0 working · 0 queued · 1 done')
})

describe('Helpers model', () => {
  test('10. stepDownModel walks the ladder to Haiku', async () => {
    expect(stepDownModel('Opus 5.5')).toBe('Sonnet 5.5')
    expect(stepDownModel('Sonnet 5.5')).toBe('Haiku 4.5')
    expect(stepDownModel('Haiku 4.5')).toBe('Haiku 4.5')
    expect(stepDownModel('Fable 5.1')).toBe('Opus 5.5')
    expect(helperModelAlias('stepDown', 'claude-opus-5-5[1m]')).toBe('sonnet')
  })

  test('11. stepDownEffort walks down to low', async () => {
    expect(stepDownEffort('high')).toBe('medium')
    expect(stepDownEffort('low')).toBe('low')
  })

  test('12. fast rewrites unnamed helpers to Haiku above size 1 only', async ($, on) => {
    const seen = await start($, on)
    await dock($, 'helpers fast')
    await dock($, '5')
    await request($)
    await agent($, 'Price check: Panera')
    await agent($, 'Price check: Crumbl', 'opus')
    expect(seen.agentCalls[0]?.model).toBe('haiku')
    expect(seen.agentCalls[1]?.model).toBe('opus')

    await dock($, '1')
    await request($, 'Another request')
    await agent($, 'Price check: Insomnia')
    expect(seen.agentCalls[2]?.model).toBeUndefined()
  })

  test('13. panel.helperModel survives a new session', async ($, on) => {
    await start($, on, { 'panel.helperModel': 'stepDown' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
    expect(await ui.find({ key: 'helpers-stepDown' })).toBeUndefined()
    expect(await ui.find({ key: 'helpers-same' })).toBeDefined()
    await ui.unmount()
  })
})
