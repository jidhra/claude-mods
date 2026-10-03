import { describe, expect, test } from 'claude-code/testing'

import { questionsIn, todosIn, urlPins } from '../hooks/register'

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
  test('questions come from prose lines ending in ?, not code or quotes', () => {
    const answer = '1. Keep the pane?\n2. **Add tests?**\n```\nok?\n```\n> quoted?\nPlain line.'
    expect(questionsIn(answer)).toEqual(['Keep the pane?', 'Add tests?'])
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
  test('a reply pins its questions and todos, and the next reply replaces the questions', async ($, on) => {
    on('turn.complete', () => ({ text: '' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.turn.complete(turn('- [x] Write it\n- [ ] Test it\n\nShould I ship it?', 't1'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const all = await texts(ui)
      expect(all).toContain('? Should I ship it?')
      expect(all).toContain('✓ Write it')
      expect(all).toContain('○ Test it')
      expect(all).toContain('1/2')
      // The bullet sits apart from wrapping text, so a second line indents under the text
      expect((await ui.find({ type: 'Text', text: 'Test it' }))?.props.wrap).toBe('wrap')
      expect((await ui.find({ type: 'Text', text: 'Should I ship it?' }))?.props.wrap).toBe('wrap')
      await ui.unmount()
    }
    await $.turn.complete(turn('Done. - nothing to ask', 't2'))
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await texts(ui)).toContain('No open questions.')
    expect(await texts(ui)).toContain('○ Test it')
    await ui.unmount()
    // A new checkbox list replaces the old one, so reworded items don't linger
    await $.turn.complete(turn('- [x] Write and test it\n- [ ] Ship it', 't3'))
    const next = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const all = await texts(next)
    expect(all).toContain('✓ Write and test it')
    expect(all).toContain('○ Ship it')
    expect(all).not.toContain('Test it')
  })

  test('links from a tool result are pinned and clear empties them', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: 'https://github.com/o/repo/pull/12\n', stderr: '', interrupted: false },
      text: 'https://github.com/o/repo/pull/12\n',
    }))
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
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
