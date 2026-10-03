import { describe, expect, test } from 'claude-code/testing'

import { decisionsIn, todosIn, urlPins } from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const
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

const turn = (answer: string, turnId = 't') => ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' as const })

describe('parse', () => {
  test('decisions come from [?] and [=] items, not plain questions or code', () => {
    const answer = 'Why did it break?\n- [?] Keep the pane?\n- [=] **Add tests?**: yes\n```\n- [?] in code\n```'
    expect(decisionsIn(answer)).toEqual(['Keep the pane?'])
    expect(decisionsIn('- [=] Keep the pane?: yes')).toEqual([])
    expect(decisionsIn('Should I ship it?')).toBeUndefined()
  })

  test('checkboxes become todos, numbered lines do not', () => {
    expect(todosIn('- [ ] Write it\n* [x] Test it\n1. not a todo')).toEqual([
      { text: 'Write it', isDone: false },
      { text: 'Test it', isDone: true },
    ])
  })

  test('URLs get short GitHub labels and lose trailing punctuation', () => {
    const pins = urlPins('See https://github.com/o/hivemind/pull/338, and https://mail.google.com/mail/#drafts/abc). Skip https://x.com/a@b')
    expect(pins).toEqual([
      { href: 'https://github.com/o/hivemind/pull/338', label: 'hivemind PR #338' },
      { href: 'https://mail.google.com/mail/#drafts/abc', label: 'mail.google.com/mail/#drafts/abc' },
    ])
  })
})

describe('pane', () => {
  test('decisions stay until decided, and todo lists replace each other', async ($, on) => {
    on('turn.complete', () => ({ text: '' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.turn.complete(turn('- [x] Write it\n- [ ] Test it\n\n- [?] Should I ship it?\n- [?] Which owner?', 't1'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const all = await texts(ui)
      expect(all).toContain('? Should I ship it?')
      expect(all).toContain('✓ Write it')
      expect(all).toContain('○ Test it')
      expect(all).toContain('? Which owner?')
      expect(all).toContain('1/2')
      // The bullet sits apart from wrapping text, so a second line indents under the text
      expect((await ui.find({ type: 'Text', text: 'Test it' }))?.props.wrap).toBe('wrap')
      expect((await ui.find({ type: 'Text', text: 'Should I ship it?' }))?.props.wrap).toBe('wrap')
      await ui.unmount()
    }
    // A reply without markers leaves the decisions alone
    await $.turn.complete(turn('Thanks. Anything else?', 't2'))
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await texts(ui)).toContain('? Which owner?')
    expect(await texts(ui)).toContain('○ Test it')
    await ui.unmount()
    // Deciding one leaves the other open; deciding the last empties the section
    await $.turn.complete(turn('- [=] Should I ship it?: yes\n- [?] Which owner?', 't3'))
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await texts(ui)).not.toContain('Should I ship it?')
    expect(await texts(ui)).toContain('? Which owner?')
    await ui.unmount()
    await $.turn.complete(turn('- [=] Which owner?: sirkitree', 't4'))
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await texts(ui)).toContain('No open decisions.')
    await ui.unmount()
    // A new checkbox list replaces the old one, so reworded items don't linger
    await $.turn.complete(turn('- [x] Write and test it\n- [ ] Ship it', 't5'))
    const next = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const all = await texts(next)
    expect(all).toContain('✓ Write and test it')
    expect(all).toContain('○ Ship it')
    expect(all).not.toContain('Test it')
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
    const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await first.findAll({ type: 'Link' })).toHaveLength(1)
    await first.unmount()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Link' }))?.props.label).toBe('repo PR #12')
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'clear-links' })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
  })

  test('the system prompt asks for checkbox todo lists', async ($, on) => {
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
    const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
    expect(sections.map(s => s.id)).toEqual(['intro', 'pinboard:todos'])
  })
})
