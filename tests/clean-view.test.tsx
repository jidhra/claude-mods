import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'clean-view',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

/** Starts a session with a mocked store, and answers every tool with "ok". */
async function start($: Engine, on: On, above?: string) {
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return above === undefined ? <Box /> : <Text>{above}</Text>
  })
  on('tool.call', async () => ({ result: 'ok' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

test('tools run without any plan first', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'Build me a landing page', turnId: 't1' }).catch(() => undefined)

  const read = await $.tool.call({ tool: 'Read', file_path: '/tmp/notes.md' })
  expect(read.deny).toBeUndefined()
  expect(read.result).toBe('ok')
})

test('/simple off flips the button, and pressing it turns Clean View back on', async ($, on) => {
  await start($, on)

  const answer = await $.command.run({
    command: 'simple',
    args: 'off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(answer.text).toBe('Clean View is off.')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('○ Clean View: OFF')

  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('● Clean View: ON')
  await ui.unmount()
})

test("another plugin's band stacks above the button", async ($, on) => {
  await start($, on, 'another panel')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: 'another panel' })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})
