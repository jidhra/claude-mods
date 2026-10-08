import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ConfigRow, On } from 'claude-code'

import { effortFor, modName, modelFor } from '../hooks/jidhras-tools'

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

type Plugin = { id: string; enabled: boolean; installPath: string; isMod: boolean }

function plugin(id: string, isMod = true, enabled = true): Plugin {
  return { id, enabled, installPath: `/plugins/${id}`, isMod }
}

/** Codex is not a mod; Jidhra's Tools never lists itself. */
const PLUGINS_SPEC = [
  'clean-view@claude-mods',
  'flightdeck@claude-mods',
  'buffer-pane@claude-mods',
  'pinboard@claude-mods',
  'secret-redactor@claude-mods',
]
const OTHER_MODS = PLUGINS_SPEC.filter(id => id !== 'clean-view@claude-mods').sort()
let PLUGINS: Plugin[] = []
function freshPlugins(): Plugin[] {
  PLUGINS = [...PLUGINS_SPEC.map(id => plugin(id)), plugin('codex@openai-codex', false), plugin('jidhras-tools@claude-mods')]
  return PLUGINS
}
type Sets = { key: string; value: unknown }[]

/** Starts a session whose /config shows Opus 5.5 and High, recording commands and config writes. */
async function start(
  $: Engine,
  on: On,
  rows: ConfigRow[] = [row('model', 'Model', 'Opus 5.5'), row('effortLevel', 'Effort', 'high')],
  below?: string,
  plugins: Plugin[] = freshPlugins(),
) {
  const runs: Runs = []
  const sets: Sets = []
  const argvs: string[][] = []
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('process.run', async (_$, e) => {
    argvs.push([...e.argv])
    const [, , verb, id] = e.argv
    const plugin = plugins.find(p => p.id === id)
    if (plugin !== undefined && (verb === 'enable' || verb === 'disable')) {
      plugin.enabled = verb === 'enable'
    }
    const stdout = verb === 'list' ? JSON.stringify(plugins.map(({ isMod: _, ...rest }) => rest)) : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', async (_$, e) => {
    const plugin = plugins.find(p => e.path === `${p.installPath}/hooks/hooks.json`)
    if (plugin === undefined) {
      throw new Error('missing')
    }

    return { value: plugin.isMod ? '{ "modules": ["./register.tsx"] }' : '{ "hooks": {} }' }
  })
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

  return { runs, sets, argvs }
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
    expect((await band.find({ key: 'mod:clean-view@claude-mods' }))?.props.label).toBe(' ● On ')
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

test('MODS lists the installed mods by name, without Codex or itself', async ($, on) => {
  await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await band.findAll({ type: 'Text' })).map(found => found.text)
  expect(texts).toContain('M O D S')
  expect(texts).toContain('Clean View')
  expect(texts).toContain('Flightdeck')
  expect(texts).toContain('Buffer Pane')
  expect(texts).toContain('Pinboard')
  expect(texts).toContain('Secret Redactor')
  expect(texts).toContain('hides secrets & PII')
  expect(texts.some(text => /Codex|Jidhras Tools/.test(text))).toBe(false)
  expect(texts.some(text => /Helpers|Agent Dock|L A U N C H/.test(text))).toBe(false)
  expect(await band.find({ key: 'mods:allOn' })).toBeDefined()
  expect(await band.find({ key: 'mods:allOff' })).toBeDefined()
  await band.unmount()
})

test('the Clean View switch runs /simple and leaves the plugin enabled', async ($, on) => {
  const { runs, argvs } = await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'mod:clean-view@claude-mods' })
  expect(runs).toContainEqual({ command: 'simple', args: 'off' })
  expect(argvs.some(argv => argv[2] === 'disable')).toBe(false)
  await band.unmount()
})

test('switching another mod off disables its plugin and reloads', async ($, on) => {
  const { runs, argvs } = await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'mod:flightdeck@claude-mods' })
  expect(argvs).toContainEqual(['claude', 'plugin', 'disable', 'flightdeck@claude-mods', '--scope', 'user'])
  expect(runs).toContainEqual({ command: 'reload-plugins', args: '' })
  expect((await band.find({ key: 'mod:flightdeck@claude-mods' }))?.props.label).toBe(' ○ Off ')
  await band.unmount()
})

test('All off runs /simple off and disables every other mod; All on reverses it', async ($, on) => {
  const { runs, argvs } = await start($, on)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'mods:allOff' })
  expect(runs).toContainEqual({ command: 'simple', args: 'off' })
  const disabled = argvs.filter(argv => argv[2] === 'disable').map(argv => argv[3])
  expect(disabled.sort()).toEqual(OTHER_MODS)
  expect(runs.filter(run => run.command === 'reload-plugins')).toHaveLength(1)

  await band.press({ key: 'mods:allOn' })
  const enabled = argvs.filter(argv => argv[2] === 'enable').map(argv => argv[3])
  expect(enabled.sort()).toEqual(OTHER_MODS)
  expect(runs).toContainEqual({ command: 'simple', args: 'on' })
  await band.unmount()
})

test('a disabled Clean View is switched on by enabling its plugin', async ($, on) => {
  const plugins = freshPlugins()
  plugins[0]!.enabled = false
  const { argvs } = await start($, on, undefined, undefined, plugins)
  await openPanel($, 'terminal')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'mod:clean-view@claude-mods' })
  expect(argvs).toContainEqual(['claude', 'plugin', 'enable', 'clean-view@claude-mods', '--scope', 'user'])
  await band.unmount()
})

test('mod names come from plugin ids', () => {
  expect(modName('clean-view@claude-mods')).toBe('Clean View')
  expect(modName('flightdeck@claude-mods')).toBe('Flightdeck')
  expect(modName('secret-redactor@claude-mods')).toBe('Secret Redactor')
})
