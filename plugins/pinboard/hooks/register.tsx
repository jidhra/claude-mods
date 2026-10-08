import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Decision, Pin, Todo } from '../types'

const PANE = 'pinboard'
const TITLE = 'Pinboard'
// Docked width; matches Flightdeck's so the dock doesn't jump between panes
const PANE_COLUMNS = 66
const TOOL = 'mcp__pinboard__update'

const decisions = atom({ plugin: 'pinboard', key: 'decisions' } as const, [] as Decision[])
const todos = atom({ plugin: 'pinboard', key: 'todos' } as const, [] as Todo[])
const links = atom({ plugin: 'pinboard', key: 'links' } as const, [] as Pin[])
const paneOpen = atom({ plugin: 'pinboard', key: 'paneOpen' } as const, false)

const DESCRIPTION = [
  "Keep the session's task list and open decisions on the user's Pinboard, a sidebar that stays in view while the transcript scrolls.",
  'Use it in place of writing task lists or decision lists in your reply, whenever the work takes 2+ distinct steps or the user gives new instructions.',
  'add_todos: one action per item. start_todo: the todo id you are working on now; exactly one is in progress at a time. done_todos / remove_todos: todo ids.',
  'Update in real time; do not batch completions. Mark a todo done only after the work is actually done, including any verification it needs, never based on intent.',
  'If blocked or partly done, leave it in progress and add a follow-up todo describing the blocker.',
  'open_decisions: questions that need the user to choose. decide: close a decision by id once the user has answered.',
  'The current board, with ids, is at the end of your system prompt.',
  "It is session-only: work that must outlive the session goes to a durable tracker (kindex task_add) instead.",
].join(' ')

// Pinboard is the person's task tracker; this rides in the system prompt beside the board
export const GUIDE = [
  "Pinboard is the user's task tracker (a pane beside the transcript); keep it current instead of listing tasks in replies.",
  `For any job with 2+ steps, add the todos with ${TOOL} before starting work (load it with ToolSearch first if it is deferred).`,
  'start_todo as each one begins; done_todos as each one finishes, after verifying it.',
  'Put questions that need the user in open_decisions.',
  "Pinboard holds only this session's steps and questions (/clear empties it). Kindex task_add is for work that must outlive the session (follow-ups, deferred items), never for the steps of the current job.",
].join('\n')

// Theme colour names (Flightdeck's palette), so light, dark and colour-blind themes all work
const C = {
  main: 'claude',
  agent: 'suggestion',
  gate: 'success',
  amber: 'warning',
  dim: 'inactive',
  faint: 'subtle',
} as const

/** A gauge of `width` cells: ▰ filled, ▱ empty. */
const gauge = (done: number, total: number, width: number) => {
  const full = total ? Math.max(0, Math.min(width, Math.round((done / total) * width))) : 0
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

/** Legend items that fit on one row of `width` cells, in order; the rest are dropped. */
const fitLegend = <T extends { label: string }>(items: T[], width: number) => {
  const out: T[] = []
  let used = 0
  for (const it of items) {
    const w = it.label.length + 4
    if (used + w > width) break
    out.push(it)
    used += w
  }
  return out
}

const strings = { type: 'array', items: { type: 'string' } }
const SCHEMA = {
  type: 'object',
  properties: {
    add_todos: strings,
    start_todo: { type: 'string' },
    done_todos: strings,
    remove_todos: strings,
    open_decisions: strings,
    decide: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, answer: { type: 'string' } }, required: ['id', 'answer'] },
    },
  },
}

export type Update = {
  add_todos?: string[]
  start_todo?: string
  done_todos?: string[]
  remove_todos?: string[]
  open_decisions?: string[]
  decide?: { id: string; answer: string }[]
}

type Board = { todos: Todo[]; decisions: Decision[] }

// The next id for a prefix: one past the highest in use
const nextId = (prefix: string, ids: string[]) =>
  prefix + (Math.max(0, ...ids.map(id => Number(id.slice(prefix.length)) || 0)) + 1)

export function applyUpdate(board: Board, change: Update): Board {
  let { todos: t, decisions: d } = board
  for (const text of change.add_todos ?? []) t = [...t, { id: nextId('t', t.map(x => x.id)), text, isDone: false }]
  for (const text of change.open_decisions ?? []) d = [...d, { id: nextId('d', d.map(x => x.id)), text }]
  const done = new Set(change.done_todos ?? [])
  const removed = new Set(change.remove_todos ?? [])
  const decided = new Set((change.decide ?? []).map(x => x.id))
  t = t.filter(x => !removed.has(x.id)).map(x => (done.has(x.id) ? { ...x, isDone: true } : x))
  // One todo in progress at a time; finishing it ends its turn too
  if (change.start_todo) t = t.map(x => ({ ...x, isActive: x.id === change.start_todo }))
  t = t.map(x => (x.isDone && x.isActive ? { ...x, isActive: false } : x))
  d = d.filter(x => !decided.has(x.id))
  return { todos: t, decisions: d }
}

export function describeBoard(board: Board): string {
  if (board.todos.length + board.decisions.length === 0) return 'Pinboard is empty.'
  return [
    'Pinboard now:',
    ...board.todos.map(t => `${t.id} [${t.isDone ? 'x' : t.isActive ? '>' : ' '}] ${t.text}`),
    ...board.decisions.map(d => `${d.id} [?] ${d.text}`),
  ].join('\n')
}

const MAKES_COMMAND = /\bgh\s+(?:(?:pr|issue|release|repo|gist)\s+create|(?:pr|issue)\s+comment)\b|\bgit\s+push\b/
const MAKES_MCP = /^mcp__.*(?:create|draft|send|publish|share|canvas|upload)/i

const URL = /https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9\-._~:/?#[\]!$&'()*+,;=%@]*)?/g

export const urlPins = (text: string): Pin[] =>
  [...new Set([...text.matchAll(URL)].map(m => m[0].replace(/[)\].,;:'!?*]+$/, '')))]
    .filter(href => !href.includes('@') && href.length <= 2048)
    .map(href => {
      const gh = /github\.com\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/.exec(href)
      return { href, label: gh ? `${gh[1]} ${gh[2] === 'pull' ? 'PR' : 'issue'} #${gh[3]}` : href.slice(8) }
    })

const isEmpty = async ($: EngineInterface) =>
  (await read($, decisions)).length + (await read($, todos)).length + (await read($, links)).length === 0

// Runs a capture; opens the pane when it puts the first thing on an empty board
async function capture($: EngineInterface, change: () => Promise<unknown>): Promise<void> {
  const wasEmpty = await isEmpty($)
  await change()
  if (wasEmpty && !(await isEmpty($))) await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pinboard',
      description: 'Open the pane of open decisions, todos and links; `close` hides it',
      argumentHint: '[close]',
      immediate: true,
    })
    await $.tool.register({ name: 'update', description: DESCRIPTION, inputSchema: SCHEMA })
    // Todos parsed from replies by older versions have no id; the tool can't reach them
    await update($, todos, old => old.filter(t => typeof t.id === 'string'))
    // A reload keeps the pane up but starts the module over: re-read whether it is open
    const isUp = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
    await update($, paneOpen, () => isUp)
    // No open on launch: only Flightdeck opens unasked, so Pinboard's tab lands second when its first item does
    return next(e)
  })

  on('command.run', { command: 'pinboard' }, async ($, e) => {
    if (/^(close|hide)$/i.test(e.args.trim())) {
      await $.ui.close({ id: PANE })
      return {}
    }
    await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    return {}
  })

  // Mod Tools' Show column reads paneOpen; the engine lists a plugin's panes only to that plugin
  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    await update($, paneOpen, () => true)
    return opened
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneOpen, () => false)
    return closed
  }).catch(($, e, next) => next(e))

  // The board rides at the end of the system prompt, so it never has to be repeated in replies
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    const board = describeBoard({ todos: await read($, todos), decisions: await read($, decisions) })
    return {
      sections: [
        ...sections,
        { id: 'pinboard:guide', text: GUIDE, scope: 'session' },
        { id: 'pinboard:board', text: board, scope: 'session' },
      ],
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId) return { deny: 'Only the main conversation updates the Pinboard.' }
    let board: Board = { todos: [], decisions: [] }
    await capture($, async () => {
      board = applyUpdate({ todos: await read($, todos), decisions: await read($, decisions) }, e as Update)
      await update($, todos, () => board.todos)
      await update($, decisions, () => board.decisions)
    })
    return { result: describeBoard(board) }
  })

  // Links only from actions that make something; reads, fetches and test output just mention URLs
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const makes = e.tool === 'Bash' ? MAKES_COMMAND.test(e.command) : MAKES_MCP.test(e.tool)
    if (e.agentId || !makes || !('text' in ran) || ran.isError) return ran
    const found = urlPins(ran.text ?? '')
    if (found.length > 0 && found.length <= 3) {
      await capture($, () => update($, links, old => [...found, ...old.filter(p => !found.some(f => f.href === p.href))].slice(0, 12)))
    }
    return ran
  })

  // An update is one dim line in the transcript; the board itself is in the pane
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const change = (e.props.input ?? {}) as Update
    const parts = [
      change.add_todos?.length && `+${change.add_todos.length} todo`,
      change.start_todo && `started ${change.start_todo}`,
      change.done_todos?.length && `${change.done_todos.length} done`,
      change.remove_todos?.length && `-${change.remove_todos.length} todo`,
      change.open_decisions?.length && `+${change.open_decisions.length} decision`,
      change.decide?.length && `${change.decide.length} decided`,
    ].filter(Boolean)
    return <Text dimColor>{'Pinboard: ' + (parts.join(', ') || 'no change')}</Text>
  })

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) =>
    e.props.isErrored ? next(e) : $.ui.resolve(e).Text({ children: [''] }),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const W = Math.max(40, e.props.bodyColumns)
    // A card's text area: the width less its border and one cell of padding each side
    const inner = W - 4
    const allDecisions = await read($, decisions)
    const allTodos = await read($, todos)
    const allLinks = await read($, links)
    const doneCount = allTodos.filter(t => t.isDone).length
    const openCount = allTodos.length - doneCount

    // A card's first row: the upper-case label and subtitle in its accent, a dim state on the right
    const header = (accent: Color, label: string, subtitle: string, right: RenderChildren) => (
      <Box justifyContent="space-between" width={inner}>
        <Text color={accent} bold wrap="truncate">
          {`${label.toUpperCase()} · ${subtitle}`}
        </Text>
        {right}
      </Box>
    )
    // The glyph stays in its own column, so wrapped lines indent under the text
    const item = (glyph: RenderChildren, text: string, props: { color?: Color; bold?: boolean; dimColor?: boolean } = {}) => (
      <Box flexDirection="row" width={inner}>
        <Box width={2} flexShrink={0}>
          {glyph}
        </Box>
        <Box flexShrink={1} flexGrow={1}>
          <Text {...props} wrap="wrap">
            {text}
          </Text>
        </Box>
      </Box>
    )
    const rule = <Text color={C.faint}>{'─'.repeat(W)}</Text>

    const g = gauge(doneCount, allTodos.length, 8)
    const todoCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.main} paddingX={1} width={W}>
        {header(
          C.main,
          'todos',
          `${openCount} open`,
          <Text>
            <Text color={C.main}>{g.on}</Text>
            <Text color={C.faint}>{g.off}</Text>
            <Text dimColor>{` ${doneCount}/${allTodos.length}`}</Text>
          </Text>,
        )}
        {allTodos
          .filter(t => !t.isDone)
          .map(t =>
            t.isActive
              ? item(<Text color={C.main} bold>{'▶ '}</Text>, t.text, { color: C.main, bold: true })
              : item(<Text dimColor>{'○ '}</Text>, t.text),
          )}
        {/* Finished todos fold into one line so open work stays on top */}
        {doneCount > 0 && (
          <Text>
            <Text color={C.gate}>{'✓ '}</Text>
            <Text dimColor>{`${doneCount} done`}</Text>
          </Text>
        )}
      </Box>
    )

    const decisionCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.amber} paddingX={1} width={W}>
        {header(C.amber, 'decisions', 'needs you', <Text dimColor>{`${allDecisions.length} open`}</Text>)}
        {allDecisions.map(d => item(<Text color={C.amber} bold>{'? '}</Text>, d.text))}
      </Box>
    )

    const linkCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.agent} paddingX={1} width={W}>
        {header(
          C.agent,
          'links',
          'created',
          <Box columnGap={1}>
            <Text dimColor>{String(allLinks.length)}</Text>
            <Button key="clear-links" label="clear" hotkey="l" plain dimColor onPress={() => update($, links, () => [])} />
          </Box>,
        )}
        {allLinks.map(p => (
          <Text wrap="truncate-middle">
            <Link href={p.href} label={p.label} />
          </Text>
        ))}
      </Box>
    )

    const emptyCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={W}>
        <Text dimColor>pinboard</Text>
        <Text color={C.faint}>nothing yet</Text>
      </Box>
    )

    // Only sections with something in them; an empty board keeps one faint card
    const cards = [allTodos.length > 0 && todoCard, allDecisions.length > 0 && decisionCard, allLinks.length > 0 && linkCard].filter(
      Boolean,
    )

    const legend = fitLegend(
      [
        { label: 'todos', color: C.main },
        { label: 'decisions', color: C.amber },
        { label: 'links', color: C.agent },
      ],
      W,
    )

    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center">
          <Text bold wrap="truncate">
            <Text>PINBOARD</Text>
            <Text color={C.dim}> · </Text>
            <Text color={C.main}>{String(openCount)}</Text>
            <Text> TODO</Text>
            <Text color={C.dim}> · </Text>
            <Text color={C.amber}>{String(allDecisions.length)}</Text>
            <Text>{allDecisions.length === 1 ? ' DECISION' : ' DECISIONS'}</Text>
          </Text>
        </Box>
        <Box justifyContent="center" columnGap={2}>
          {legend.map(l => (
            <Text>
              <Text color={l.color}>■</Text>
              <Text dimColor>{` ${l.label}`}</Text>
            </Text>
          ))}
        </Box>
        {cards.length === 0
          ? emptyCard
          : cards.map((card, i) => (
              <Box flexDirection="column">
                {i > 0 && rule}
                {card}
              </Box>
            ))}
      </Box>
    )
  })
}
