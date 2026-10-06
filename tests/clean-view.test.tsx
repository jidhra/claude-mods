import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanName } from '../hooks/clean-view'

const PLAN = 'mcp__clean-view__plan_steps'
const PROGRESS = 'mcp__clean-view__report_progress'

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

/** Starts a session with a mocked clock and store, and answers every other tool with "ok". */
async function start($: Engine, on: On, above?: string) {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return above === undefined ? <Box /> : <Text>{above}</Text>
  })
  on('tool.call', async () => ({ result: 'ok' }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__clean-view__${e.name}` } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('classic.Notification', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

async function newJob($: Engine) {
  await $.turn.start({ text: 'Build me a landing page', turnId: 't1' })
}

async function bandTexts($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()

  return texts
}

describe('plain names', () => {
  test('strips code, paths and file names, and trims long names', async () => {
    expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
    expect(cleanName('Update src/components/Header.tsx header colors')).toBe('Update header colors')
    expect(cleanName('fix the bug in app.py quickly')).toBe('Fix the bug in quickly')

    const long = 'Make the whole landing page look friendlier for every visitor who arrives from search'
    expect(long.length).toBeGreaterThan(79)
    const trimmed = cleanName(long)
    expect(trimmed.length).toBeLessThanOrEqual(40)
    expect(trimmed).toEndWith('…')

    expect(cleanName('`npm run build`')).toBe('Working on it')
  })
})

test('a to-do list plus a 60% report draws done, current, next and up-next rows', async ($, on) => {
  await start($, on)
  await newJob($)

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading your brand notes' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building the pricing section' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding the contact form' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing the footer' },
    ],
  })
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 60 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const texts = await bandTexts($, surface)
    const joined = texts.join('|')

    expect(joined).toContain('✓ ')
    expect(joined).toContain('▶ ')
    expect(texts).toContain(' 60%')
    expect(texts).toContain(' Next')
    expect(texts).toContain(' Up next')
    expect(texts).toContain(' Done')
    expect(joined).toContain('██████░░░░')
  }
})

test('a permission prompt turns the header into Needs you', async ($, on) => {
  await start($, on)
  await newJob($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] })

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  const texts = await bandTexts($, 'terminal')
  expect(texts).toContain(' Needs you ')
  expect(texts).toContain('Claude needs your OK to continue')
  expect(texts.join('|')).toContain('‖ ')
})

test('/simple off hides the band and leaves only the button', async ($, on) => {
  await start($, on)
  await newJob($)
  await $.tool.call({ tool: PLAN, steps: ['Build the pricing section', 'Add the contact form'] })

  const answer = await $.command.run({
    command: 'simple',
    args: 'off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(answer.text).toBe('Clean View is off.')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /Build the pricing section/ })).toBeUndefined()
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('○ Clean View: OFF')

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ text: /Build the pricing section/ })).toBeDefined()
  await ui.unmount()
})

test('a step reported at 100 is checked off and the next one starts', async ($, on) => {
  await start($, on)
  await newJob($)

  const planned = await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section', 'Polish the footer'] })
  expect(planned.result).toBe('Planned 3 steps. The first one has started.')

  const noted = await $.tool.call({ tool: PROGRESS, task: 'Read your brand notes', percent: 140 })
  expect(noted.result).toBe('Progress noted: 100%.')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()

  // Step one is checked off, step two is current, step three waits as "Next".
  const at = (name: string) => texts.findIndex(text => text.startsWith(name))
  expect(texts[at('Read your brand notes') - 1]).toBe('✓ ')
  expect(texts[at('Read your brand notes') + 2]).toBe(' Done')
  expect(texts[at('Build the pricing section') - 1]).toBe('▶ ')
  expect(texts[at('Build the pricing section') + 2]).toBe(' Working')
  expect(texts[at('Polish the footer') + 2]).toBe(' Next')
})

test('every tool is refused until a plan exists, then allowed', async ($, on) => {
  await start($, on)
  await newJob($)

  const before = await $.tool.call({ tool: 'Read', file_path: '/tmp/notes.md' })
  expect(String(before.deny ?? before.text)).toContain('plan_steps')

  const search = await $.tool.call({ tool: 'ToolSearch', query: 'select:plan_steps', max_results: 1 })
  expect(search.deny).toBeUndefined()
  expect(search.result).toBe('ok')

  await $.tool.call({ tool: PLAN, steps: ['Read your notes', 'Write the summary'] })

  const after = await $.tool.call({ tool: 'Read', file_path: '/tmp/notes.md' })
  expect(after.deny).toBeUndefined()
  expect(after.result).toBe('ok')
})

test("another plugin's band stacks above the checklist", async ($, on) => {
  await start($, on, 'another panel')
  await newJob($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const texts = await bandTexts($, surface)
    const other = texts.indexOf('another panel')
    expect(other).toBeGreaterThanOrEqual(0)
    expect(texts.findIndex(text => /Your request/.test(text))).toBeGreaterThan(other)
  }
})
