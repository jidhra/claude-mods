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

const PRESENTATION = { isFullscreen: false, columns: 100 } as const

/** Starts a session with a mocked store, and answers every tool with "ok". */
async function start($: Engine, on: On) {
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>another panel</Text>
  })
  on('tool.call', async () => ({ result: 'ok' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

function simple($: Engine, args: string) {
  return $.command.run({ command: 'simple', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
}

test('tools run without any plan first', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'Build me a landing page', turnId: 't1' }).catch(() => undefined)

  const read = await $.tool.call({ tool: 'Read', file_path: '/tmp/notes.md' })
  expect(read.deny).toBeUndefined()
  expect(read.result).toBe('ok')
})

test('/simple turns Clean View off, flips it back on, and explains a bad argument', async ($, on) => {
  await start($, on)

  expect((await simple($, 'off')).text).toBe('Clean View is off.')
  expect((await simple($, '')).text).toBe('Clean View is on.')
  expect((await simple($, 'maybe')).text).toBe('Use /simple on, /simple off, or just /simple to flip it.')
})

test('Clean View draws nothing above the prompt', async ($, on) => {
  await start($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: 'another panel' })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    await ui.unmount()
  }
})
