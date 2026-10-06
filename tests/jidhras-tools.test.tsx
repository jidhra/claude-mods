import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ConfigRow, On } from 'claude-code'

import { effortFor, modelFor } from '../hooks/jidhras-tools'

const SURFACES = ['terminal', 'desktop'] as const

const FOOTER = { plugin: 'jidhras-tools', component: 'SessionMode', props: { modes: [] } } as const

const BAND = {
  plugin: 'jidhras-tools',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const TOOLS = {
  command: 'tools',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const ENGINE = { plugin: 'engine', tier: 'core' } as const

function row(key: string, label: string, value: string, options?: string[]): ConfigRow {
  return { key, label, value, kind: options ? 'choice' : 'text', options, provider: ENGINE, isLocked: false }
}

type Runs = { command: string; args: string }[]
type Sets = { key: string; value: unknown }[]

/** Starts a session whose /config shows Opus 5.5 and High, recording commands and config writes. */
async function start(
  $: Engine,
  on: On,
  rows: ConfigRow[] = [row('model', 'Model', 'Opus 5.5'), row('effortLevel', 'Effort', 'high')],
  below?: string,
) {
  const runs: Runs = []
  const sets: Sets = []
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('command.list', async () => ({
    value: [{ name: 'simple', description: 'Clean View', source: 'plugin' as const, plugin: 'clean-view' }],
  }))
  on('command.run', async (_$, e) => {
    runs.push({ command: e.command, args: e.args })

    return { text: 'ok' }
  })
  on('config.list', async () => ({ value: rows }))
  on('config.set', async (_$, e) => {
    sets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  on('settings.read', async () => ({ value: {} }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return below === undefined ? <Box /> : <Text>{below}</Text>
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  return { runs, sets }
}

async function openPanel($: Engine, surface: (typeof SURFACES)[number]) {
  const footer = await $.ui.mount({ ...FOOTER, surface })
  expect((await footer.find({ key: 'open' }))?.props.label).toBe("◆ Jidhra's Tools ▾")
  await footer.press({ key: 'open' })
  expect((await footer.find({ key: 'open' }))?.props.label).toBe("◆ Jidhra's Tools ▴")
  await footer.unmount()
}

describe('names', () => {
  test('match models and efforts however they are spelled', async () => {
    expect(modelFor('claude-opus-5-5[1m]')?.label).toBe('Opus 5.5')
    expect(modelFor('Sonnet 5.5')?.label).toBe('Sonnet 5.5')
    expect(modelFor('haiku')?.hasEffort).toBe(false)
    expect(modelFor('Default (recommended)')).toBeNull()
    expect(effortFor('XHigh')?.value).toBe('xhigh')
    expect(effortFor(null)).toBeNull()
  })
})

test('the footer button opens a panel showing the current model and effort', async ($, on) => {
  await start($, on)

  for (const surface of SURFACES) {
    const closed = await $.ui.mount({ ...BAND, surface })
    expect(await closed.find({ text: /J I D H R A/ })).toBeUndefined()
    await closed.unmount()

    await openPanel($, surface)
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ text: /J I D H R A ' S/ })).toBeDefined()
    expect(await band.find({ text: 'Opus 5.5 · High' })).toBeDefined()
    expect(await band.find({ key: 'model:opus' })).toBeUndefined()
    expect(await band.find({ key: 'model:sonnet' })).toBeDefined()
    expect(await band.find({ key: 'effort:high' })).toBeUndefined()
    expect((await band.find({ key: 'cleanView' }))?.props.label).toBe(' ● On ')
    await band.unmount()

    const footer = await $.ui.mount({ ...FOOTER, surface })
    await footer.press({ key: 'open' })
    await footer.unmount()
  }
})

test('picking a model runs /model with its full id', async ($, on) => {
  const { runs } = await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'model:sonnet' })
  expect(runs).toContainEqual({ command: 'model', args: 'claude-sonnet-5-5' })
  expect(await band.find({ text: 'Sonnet 5.5 · High' })).toBeDefined()
  expect(await band.find({ key: 'model:opus' })).toBeDefined()
  expect(await band.find({ key: 'model:sonnet' })).toBeUndefined()
  await band.unmount()
})

test('picking an effort sets the /config effort row', async ($, on) => {
  const { sets, runs } = await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'effort:xhigh' })
  expect(sets).toContainEqual({ key: 'effortLevel', value: 'xhigh' })
  expect(runs.some(run => run.command === 'effort')).toBe(false)
  expect(await band.find({ text: 'Opus 5.5 · XHigh' })).toBeDefined()
  await band.unmount()
})

test('without an effort row, picking an effort runs /effort', async ($, on) => {
  const { runs } = await start($, on, [row('model', 'Model', 'Opus 5.5')])
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'effort:max' })
  expect(runs).toContainEqual({ command: 'effort', args: 'max' })
  await band.unmount()
})

test('Haiku shows no effort choices', async ($, on) => {
  await start($, on, [row('model', 'Model', 'Haiku 4.5'), row('effortLevel', 'Effort', 'high')])
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Haiku 4.5' })).toBeDefined()
  expect(await band.find({ key: 'effort:low' })).toBeUndefined()
  expect(await band.find({ text: /doesn't use an effort setting/ })).toBeDefined()
  await band.unmount()
})

test('the Clean View switch runs /simple', async ($, on) => {
  const { runs } = await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'cleanView' })
  expect(runs).toContainEqual({ command: 'simple', args: 'off' })
  await band.unmount()
})

test('/tools opens and closes the panel', async ($, on) => {
  await start($, on)

  const opened = await $.command.run(TOOLS)
  expect(opened.text).toMatch(/open/)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /J I D H R A/ })).toBeDefined()
  await band.unmount()

  const closed = await $.command.run(TOOLS)
  expect(closed.text).toMatch(/closed/)
})

test('the panel stacks above whatever else draws in the band', async ($, on) => {
  await start($, on, undefined, 'checklist below')
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await band.findAll({ type: 'Text' })).map(found => found.text)
  const title = texts.findIndex(text => /J I D H R A/.test(text))
  const below = texts.indexOf('checklist below')
  expect(title).toBeGreaterThanOrEqual(0)
  expect(below).toBeGreaterThan(title)
  await band.unmount()
})
