import { describe, expect, test } from 'claude-code/testing'

import { applyUpdate, describeBoard, urlPins } from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const
const TOOL = 'mcp__pinboard__update'
const PANE = {
  plugin: 'pinboard',
  component: 'Pane',
  requestId: 'pinboard',
  props: {
    title: 'Pinboard',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')

describe('board', () => {
  test('updates add, check off, remove and decide by id', () => {
    let board = applyUpdate({ todos: [], decisions: [] }, { add_todos: ['Write it', 'Test it', 'Drop it'], open_decisions: ['Ship it?', 'Which owner?'] })
    expect(board.todos.map(t => t.id)).toEqual(['t1', 't2', 't3'])
    expect(board.decisions.map(d => d.id)).toEqual(['d1', 'd2'])
    board = applyUpdate(board, { done_todos: ['t1'], remove_todos: ['t3'], decide: [{ id: 'd1', answer: 'yes' }] })
    expect(board.todos).toEqual([
      { id: 't1', text: 'Write it', isDone: true },
      { id: 't2', text: 'Test it', isDone: false },
    ])
    expect(board.decisions).toEqual([{ id: 'd2', text: 'Which owner?' }])
    expect(applyUpdate(board, { add_todos: ['Ship it'] }).todos.at(-1)?.id).toBe('t3')
  })

  test('one todo is in progress at a time, and finishing it ends that', () => {
    let board = applyUpdate({ todos: [], decisions: [] }, { add_todos: ['a', 'b'], start_todo: 't1' })
    expect(board.todos.map(t => !!t.isActive)).toEqual([true, false])
    board = applyUpdate(board, { start_todo: 't2' })
    expect(board.todos.map(t => !!t.isActive)).toEqual([false, true])
    board = applyUpdate(board, { done_todos: ['t2'] })
    expect(board.todos.some(t => t.isActive)).toBe(false)
    expect(describeBoard(applyUpdate(board, { start_todo: 't1' }))).toBe('Pinboard now:\nt1 [>] a\nt2 [x] b')
  })

  test('the board reads back with ids', () => {
    expect(describeBoard({ todos: [], decisions: [] })).toBe('Pinboard is empty.')
    expect(describeBoard({ todos: [{ id: 't1', text: 'Write it', isDone: true }], decisions: [{ id: 'd1', text: 'Which owner?' }] })).toBe(
      'Pinboard now:\nt1 [x] Write it\nd1 [?] Which owner?',
    )
  })

  test('URLs get short GitHub labels and lose trailing punctuation', () => {
    const pins = urlPins('See https://github.com/o/hivemind/pull/338, and https://mail.google.com/mail/#drafts/abc). Skip https://x.com/a@b')
    expect(pins).toEqual([
      { href: 'https://github.com/o/hivemind/pull/338', label: 'hivemind PR #338' },
      { href: 'https://mail.google.com/mail/#drafts/abc', label: 'mail.google.com/mail/#drafts/abc' },
    ])
  })
})

describe('session', () => {
  test('the tool updates the pane and the system prompt carries the board', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
    const first = await $.tool.call({ tool: TOOL, add_todos: ['Write it', 'Test it', 'Ship it'], open_decisions: ['Should I ship it?', 'Which owner?'] })
    expect('result' in first && first.result).toContain('d2 [?] Which owner?')
    await $.tool.call({ tool: TOOL, done_todos: ['t1'], start_todo: 't2', decide: [{ id: 'd1', answer: 'yes' }] })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const all = await texts(ui)
      // Finished todos fold into one line; the active one is marked and colored
      expect(all).toContain('✓ 1 done')
      expect(all).not.toContain('Write it')
      expect(all).toContain('▸ Test it')
      expect((await ui.find({ type: 'Text', text: 'Test it' }))?.props.color).toBe('warning')
      expect(all).toContain('○ Ship it')
      expect(all).toContain('1/3')
      expect(all).toContain('? Which owner?')
      expect(all).not.toContain('Should I ship it?')
      // The bullet sits apart from wrapping text, so a second line indents under the text
      expect((await ui.find({ type: 'Text', text: 'Which owner?' }))?.props.wrap).toBe('wrap')
      await ui.unmount()
    }
    const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
    expect(sections.at(-1)?.text).toBe('Pinboard now:\nt1 [x] Write it\nt2 [>] Test it\nt3 [ ] Ship it\nd2 [?] Which owner?')
  })

  test('the tool call shows as one dim line in the transcript', async $ => {
    const ui = await $.ui.mount({
      plugin: 'pinboard',
      surface: 'terminal',
      component: 'ToolUse',
      props: { tool_use_id: 'u1', tool: TOOL, input: { add_todos: ['a', 'b'], decide: [{ id: 'd1', answer: 'x' }] }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(await texts(ui)).toBe('Pinboard: +2 todo, 1 decided')
  })

  test('links come only from actions that make something, and clear empties them', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.call', { tool: 'Bash' }, (_$, e) => {
      const url = e.command.startsWith('gh') ? 'https://github.com/o/repo/pull/12' : 'https://github.com/o/fixture/pull/99'
      return { result: { stdout: url + '\n', stderr: '', interrupted: false }, text: url + '\n' }
    })
    // A command that only prints a URL is not pinned
    await $.tool.call({ tool: 'Bash', command: 'cat tests/fixtures.ts' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const found = await ui.findAll({ type: 'Link' })
      expect(found.map(l => l.props.label)).toEqual(['repo PR #12'])
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'clear-links' })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
  })
})
