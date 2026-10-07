// Tests for the plugin's function-hooks module, run by `claude plugin test plugin` with
// `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. The kit loads the module as the engine does and hands
// each test the engine's own `$`; the hooks a test registers with `on` sit beneath the module,
// where the prompt box, the store and the terminal would be. All buffer text here is invented.
//
// A known gap: the kit cannot type into an `Input`. Its `$.ui` has `render`, `scroll`, `focus`
// and `press`, and `press` reaches a `Button` only (measured: a press on an Input's key is
// refused with "no Button ... is drawn"). The drawn tree carries no `onInput` or `onSubmit`
// closure either; the engine keeps them under a numeric handle. So what Enter and typing do to
// the buffer is tested as the plain functions the closures call (`afterSubmitOf`,
// `afterEditOf`, `storedOf`, `storeKeyOf`). The path from a change to `store.set` is tested
// end to end through the two Buttons, which use the same `commit` the Input closures use.

import type { CommandRunInput, On, RenderInput } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import {
  afterDraftOf,
  afterEditOf,
  afterEditSubmitOf,
  afterMoveOf,
  afterRemoveOf,
  afterSentOf,
  afterSubmitOf,
  blockTextsOf,
  bufferFromStore,
  emptyBuffer,
  isSentOf,
  storedOf,
  storeKeyOf,
} from '../hooks/mod'

tier('user')

const PLUGIN = 'buffer-pane'
const COMMAND = 'buffer-pane'

const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: PLUGIN,
  viewport: { columns: 120, rows: 40 },
  props: { title: PLUGIN, isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const RUN: CommandRunInput = { command: COMMAND, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }

type WorldOptions = {
  cwd?: string
  // Seeds `$.store` before `session.start` runs, so a test can simulate a hot reload: the
  // module's own in-memory state is gone, but a real store's persistence is not.
  store?: Record<string, unknown>
  isFilled?: boolean
  drop?: string
}

// The world beneath the module: a working directory, a store, a prompt box that takes a fill
// (or refuses it), and a terminal that keeps what was opened, closed and told as a status line.
function world(on: On, options: WorldOptions = {}) {
  const cwd = options.cwd ?? '/work'
  const opened: string[] = []
  const closed: string[] = []
  const statuses: (string | undefined)[] = []
  const fills: string[] = []
  const submits: string[] = []
  const reads: string[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: cwd }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  // A chain event: it answers the result itself, not `{ value }`.
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: options.isFilled ?? true }
  })

  on('prompt.submit', ($, e) => {
    submits.push(e.text)
    return options.drop === undefined ? { text: e.text } : { drop: options.drop }
  })

  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  on('store.get', ($, e) => {
    reads.push(e.key)
    return { value: store.get(e.key) }
  })
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })

  return { cwd, opened, closed, statuses, fills, submits, reads, store, session: { surface: 'terminal', isInteractive: true, cwd } as const }
}

type Row = { key: string; mark: string; value: string }

// Each block row of a drawn tree: the keyed Box, the mark its Text holds, its Input's value.
function rowsOf(tree: unknown): Row[] {
  if (Array.isArray(tree)) return tree.flatMap(rowsOf)
  if (typeof tree !== 'object' || tree === null) return []
  const props: unknown = Reflect.get(tree, 'props')
  const children: unknown = Reflect.get(tree, 'children')
  const key = typeof props === 'object' && props ? Reflect.get(props, 'key') : undefined
  if (typeof key === 'string' && /^block:\d+$/.test(key) && Array.isArray(children)) {
    let mark = ''
    let value = ''
    for (const child of children) {
      if (Reflect.get(child, 'type') === 'Text') mark = (Reflect.get(child, 'children') as unknown[]).join('')
    }
    // The Input sits in its own Box (it takes the rest of the row), so it is searched for.
    const input = inputsOf(children)[0]
    if (input !== undefined) value = String(input['value'])
    return [{ key, mark, value }]
  }
  return rowsOf(children)
}

// The `props` of every Input in a drawn tree.
function inputsOf(tree: unknown): Record<string, unknown>[] {
  if (Array.isArray(tree)) return tree.flatMap(inputsOf)
  if (typeof tree !== 'object' || tree === null) return []
  if (Reflect.get(tree, 'type') === 'Input') return [Reflect.get(tree, 'props') as Record<string, unknown>]
  return inputsOf(Reflect.get(tree, 'children'))
}

function textOf(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(textOf).join('\n')
  if (typeof tree !== 'object' || tree === null) return typeof tree === 'string' ? tree : ''
  return textOf(Reflect.get(tree, 'children'))
}

// A Button's `onPress` is not awaited by `$.ui.press`; it finishes after a few turns of the
// task queue. `setTimeout` is reached through the global object, as the module names no host
// globals of its own.
async function settle(): Promise<void> {
  const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => later(resolve, 0))
}

const SEED = { text: 'rename the flag to --dry-run\n\nadd a test for the empty list', sent: [], draft: '' }

describe('the pane', () => {
  test('the pane opens on session.start; /buffer-pane closes it, and a second /buffer-pane reopens it', async ($, on) => {
    const kept = world(on)
    await $.session.start(kept.session)
    await Promise.resolve()
    expect(kept.opened).toEqual([PLUGIN])

    const first = await $.command.run(RUN)
    expect(first.text).toBe('buffer-pane hidden')
    expect(kept.closed).toEqual([PLUGIN])

    const second = await $.command.run(RUN)
    expect(second.text).toBe('buffer-pane shown')
    expect(kept.opened).toEqual([PLUGIN, PLUGIN])
  })

  test('a buffer in the store is drawn after session.start, with no command run first', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED } })
    await $.session.start(kept.session)

    const tree = await $.ui.render(PANE)

    expect(rowsOf(tree)).toEqual([
      { key: 'block:1', mark: ' ', value: 'rename the flag to --dry-run' },
      { key: 'block:2', mark: ' ', value: 'add a test for the empty list' },
    ])
    expect(textOf(tree)).toContain('replaces the prompt box')
  })

  test('the pane draws the masthead count, the queue card with the next-up block, and the new-block card', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': { ...SEED, sent: ['add a test for the empty list'] } } })
    await $.session.start(kept.session)

    const text = textOf(await $.ui.render(PANE))

    expect(text).toContain('BUFFER PANE')
    expect(text).toContain(' QUEUED')
    expect(text).toContain('QUEUE · next up')
    expect(text).toContain('2 queued · 1 in prompt')
    expect(text).toContain('▶ 1')
    expect(text).toContain('NEW BLOCK')
    expect(text).toContain('in prompt')
  })

  test('an empty buffer draws a quiet queue card that says nothing yet', async ($, on) => {
    const kept = world(on)
    await $.session.start(kept.session)

    const tree = await $.ui.render(PANE)

    expect(rowsOf(tree)).toEqual([])
    expect(textOf(tree)).toContain('nothing yet')
    expect(textOf(tree)).toContain('NEW BLOCK')
  })

  test('the new-block field is drawn last, takes the focus, and holds the stored draft', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': { ...SEED, draft: 'half a thou' } } })
    await $.session.start(kept.session)

    const inputs = inputsOf(await $.ui.render(PANE))

    expect(inputs.at(-1)).toEqual({ key: 'draft:0', value: 'half a thou', placeholder: 'the next thing to tell the agent', submitLabel: '', autoFocus: true })
  })

  test('a press on [+] fills the prompt box with that block, and the block stays with a mark', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED } })
    await $.session.start(kept.session)
    await $.ui.render(PANE)

    await $.ui.press({ plugin: PLUGIN, key: 'block:2:fill' })
    await settle()

    expect(kept.fills).toEqual(['add a test for the empty list'])
    expect(rowsOf(await $.ui.render(PANE))).toEqual([
      { key: 'block:1', mark: ' ', value: 'rename the flag to --dry-run' },
      { key: 'block:2', mark: '✓', value: 'add a test for the empty list' },
    ])
    expect(kept.store.get('buffer:/work')).toEqual({ ...SEED, sent: ['add a test for the empty list'] })
  })

  test('when the prompt box refuses the fill, a status line says so and no mark is drawn', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED }, isFilled: false })
    await $.session.start(kept.session)
    await $.ui.render(PANE)

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:fill' })
    await settle()

    expect(kept.statuses).toHaveLength(1)
    expect(kept.statuses[0]).toContain('did not take the block')
    expect(rowsOf(await $.ui.render(PANE)).map((row) => row.mark)).toEqual([' ', ' '])
  })

  test('a press on [>] submits that block as a prompt and deletes it', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED } })
    await $.session.start(kept.session)
    await $.ui.render(PANE)

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:submit' })
    await settle()

    expect(kept.submits).toEqual(['rename the flag to --dry-run'])
    expect(kept.fills).toEqual([])
    expect(rowsOf(await $.ui.render(PANE))).toEqual([{ key: 'block:2', mark: ' ', value: 'add a test for the empty list' }])
    expect(kept.store.get('buffer:/work')).toEqual({ text: 'add a test for the empty list', sent: [], draft: '' })
  })

  test('when a hook refuses the prompt, a status line says why and the block stays', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED }, drop: 'not now' })
    await $.session.start(kept.session)
    await $.ui.render(PANE)

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:submit' })
    await settle()

    expect(kept.statuses).toEqual(['buffer-pane: the prompt was refused: not now'])
    expect(rowsOf(await $.ui.render(PANE)).map((row) => row.key)).toEqual(['block:1', 'block:2'])
  })

  test('a press on [v] moves the block down, and [^] moves it back up; the ends stay', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED } })
    await $.session.start(kept.session)
    await $.ui.render(PANE)

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:down' })
    await settle()
    expect(rowsOf(await $.ui.render(PANE)).map((row) => row.key)).toEqual(['block:2', 'block:1'])
    expect(kept.store.get('buffer:/work')).toEqual({ text: 'add a test for the empty list\n\nrename the flag to --dry-run', sent: [], draft: '' })

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:down' })
    await settle()
    expect(rowsOf(await $.ui.render(PANE)).map((row) => row.key)).toEqual(['block:2', 'block:1'])

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:up' })
    await settle()
    expect(rowsOf(await $.ui.render(PANE)).map((row) => row.key)).toEqual(['block:1', 'block:2'])
  })

  test('a press on [x] deletes that block and writes the store', async ($, on) => {
    const kept = world(on, { store: { 'buffer:/work': SEED } })
    await $.session.start(kept.session)
    await $.ui.render(PANE)

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:remove' })
    await settle()

    // The block that remains keeps its key: the row of block 2 does not become block 1.
    expect(rowsOf(await $.ui.render(PANE))).toEqual([{ key: 'block:2', mark: ' ', value: 'add a test for the empty list' }])
    expect(kept.store.get('buffer:/work')).toEqual({ text: 'add a test for the empty list', sent: [], draft: '' })
  })

  test('another working directory reads and writes another key', async ($, on) => {
    const kept = world(on, { cwd: '/elsewhere', store: { 'buffer:/work': SEED, 'buffer:/elsewhere': { text: 'bump the version', sent: [], draft: '' } } })
    await $.session.start(kept.session)

    expect(rowsOf(await $.ui.render(PANE))).toEqual([{ key: 'block:1', mark: ' ', value: 'bump the version' }])
    expect(kept.reads).toEqual(['buffer:/elsewhere'])

    await $.ui.press({ plugin: PLUGIN, key: 'block:1:remove' })
    await settle()

    expect(kept.store.get('buffer:/elsewhere')).toEqual({ text: '', sent: [], draft: '' })
    expect(kept.store.get('buffer:/work')).toEqual(SEED)
  })
})

describe('the buffer', () => {
  test('the store key holds the working directory', () => {
    expect(storeKeyOf('/work')).toBe('buffer:/work')
  })

  test('Enter in the new-block field adds a block and empties the draft', () => {
    const buffer = afterSubmitOf(afterDraftOf(emptyBuffer(), 'first  '), 'first  ')

    expect(buffer.blocks).toEqual([{ id: 1, text: 'first' }])
    expect(buffer.draft).toBe('')
    expect(storedOf(afterSubmitOf(buffer, 'second'))).toEqual({ text: 'first\n\nsecond', sent: [], draft: '' })
  })

  test('Enter in an empty new-block field adds nothing', () => {
    expect(afterSubmitOf(emptyBuffer(), '   ').blocks).toEqual([])
  })

  test('an id is not used again after its block is deleted', () => {
    const two = afterSubmitOf(afterSubmitOf(emptyBuffer(), 'a'), 'b')
    const again = afterSubmitOf(afterRemoveOf(two, 2), 'c')

    expect(again.blocks).toEqual([{ id: 1, text: 'a' }, { id: 3, text: 'c' }])
  })

  test('an edit removes the sent mark, and the mark does not come back with the old text', () => {
    const sent = afterSentOf(afterSubmitOf(emptyBuffer(), 'ship it'), 'ship it')
    const block = sent.blocks[0]!
    expect(isSentOf(sent, block)).toBe(true)

    const edited = afterEditOf(sent, 1, 'ship it now')
    expect(isSentOf(edited, edited.blocks[0]!)).toBe(false)

    const back = afterEditOf(edited, 1, 'ship it')
    expect(isSentOf(back, back.blocks[0]!)).toBe(false)
  })

  test('a space typed at the end of a sent block keeps the mark, also after a load', () => {
    const sent = afterSentOf(afterSubmitOf(emptyBuffer(), 'ship it'), 'ship it')
    const spaced = afterEditOf(sent, 1, 'ship it ')

    expect(isSentOf(spaced, spaced.blocks[0]!)).toBe(true)
    const loaded = bufferFromStore(storedOf(spaced))
    expect(isSentOf(loaded, loaded.blocks[0]!)).toBe(true)
  })

  test('a move keeps the ids and the sent marks', () => {
    const two = afterSentOf(afterSubmitOf(afterSubmitOf(emptyBuffer(), 'a'), 'b'), 'b')
    const moved = afterMoveOf(two, 2, -1)

    expect(moved.blocks).toEqual([{ id: 2, text: 'b' }, { id: 1, text: 'a' }])
    expect(isSentOf(moved, moved.blocks[0]!)).toBe(true)
    expect(afterMoveOf(moved, 2, -1)).toEqual(moved)
  })

  test('Enter in the field of an emptied block deletes the block', () => {
    const one = afterSubmitOf(emptyBuffer(), 'a')

    expect(afterEditSubmitOf(one, 1, '  ').blocks).toEqual([])
    expect(afterEditSubmitOf(one, 1, ' b ').blocks).toEqual([{ id: 1, text: 'b' }])
  })

  test('blank lines split the stored text into blocks; a block keeps its inner newline', () => {
    expect(blockTextsOf('one\nstill one\n\n\ntwo\n  \nthree\n')).toEqual(['one\nstill one', 'two', 'three'])
    expect(blockTextsOf('')).toEqual([])
  })

  test('wide characters pass through the store unchanged', () => {
    const buffer = afterSentOf(afterSubmitOf(emptyBuffer(), '空のリストのテストを足す'), '空のリストのテストを足す')

    expect(bufferFromStore(storedOf(buffer))).toEqual(buffer)
  })

  test('a store value of another shape reads as an empty buffer', () => {
    expect(bufferFromStore(undefined)).toEqual(emptyBuffer())
    expect(bufferFromStore({ blocks: ['old shape'] })).toEqual(emptyBuffer())
    expect(bufferFromStore({ text: 'kept', sent: 'not a list', draft: 7 })).toEqual({ blocks: [{ id: 1, text: 'kept' }], sent: [], draft: '', nextId: 2 })
  })
})
