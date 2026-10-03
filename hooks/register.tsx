import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, Pin, Todo } from '../types'

const PANE = 'pinboard'
const TITLE = 'Pinboard'
const TOOL = 'mcp__pinboard__update'

const decisions = atom({ plugin: 'pinboard', key: 'decisions' } as const, [] as Decision[])
const todos = atom({ plugin: 'pinboard', key: 'todos' } as const, [] as Todo[])
const links = atom({ plugin: 'pinboard', key: 'links' } as const, [] as Pin[])

const DESCRIPTION =
  "Keep the session's task list and open decisions on the user's Pinboard, a sidebar that stays in view while the transcript scrolls. " +
  'Use it in place of writing task lists or decision lists in your reply. ' +
  'add_todos: one action per item. done_todos / remove_todos: todo ids. ' +
  'open_decisions: questions that need the user to choose. decide: close a decision by id once the user has answered. ' +
  'The current board, with ids, is at the end of your system prompt.'

const strings = { type: 'array', items: { type: 'string' } }
const SCHEMA = {
  type: 'object',
  properties: {
    add_todos: strings,
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
  d = d.filter(x => !decided.has(x.id))
  return { todos: t, decisions: d }
}

export function describeBoard(board: Board): string {
  if (board.todos.length + board.decisions.length === 0) return 'Pinboard is empty.'
  return [
    'Pinboard now:',
    ...board.todos.map(t => `${t.id} [${t.isDone ? 'x' : ' '}] ${t.text}`),
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
  if (wasEmpty && !(await isEmpty($))) await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pinboard', description: 'Open the pane of open decisions, todos and links', immediate: true })
    await $.tool.register({ name: 'update', description: DESCRIPTION, inputSchema: SCHEMA })
    // Todos parsed from replies by older versions have no id; the tool can't reach them
    await update($, todos, old => old.filter(t => typeof t.id === 'string'))
    return next(e)
  })

  on('command.run', { command: 'pinboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return {}
  })

  // The board rides at the end of the system prompt, so it never has to be repeated in replies
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    const board = describeBoard({ todos: await read($, todos), decisions: await read($, decisions) })
    return { sections: [...sections, { id: 'pinboard:board', text: board, scope: 'session' }] }
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
    // One cell of padding on every side
    const inner = Math.max(10, e.props.bodyColumns - 2)
    const allDecisions = await read($, decisions)
    const allTodos = await read($, todos)
    const allLinks = await read($, links)

    const header = (title: string, count: string) => (
      <Text bold>
        {title} <Text dimColor>{count}</Text>
      </Text>
    )
    const empty = (text: string) => <Text dimColor>  {text}</Text>
    // The bullet stays in its own column, so wrapped lines indent under the text
    const item = (bullet: string, text: string, isDim = false) => (
      <Box flexDirection="row" width={inner}>
        <Text dimColor={isDim}>{'  ' + bullet + ' '}</Text>
        <Box flexShrink={1} flexGrow={1}>
          <Text dimColor={isDim} wrap="wrap">
            {text}
          </Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" width={inner + 2} padding={1}>
        {header('Open decisions', allDecisions.length ? String(allDecisions.length) : '')}
        {allDecisions.length === 0 && empty('No open decisions.')}
        {allDecisions.map(d => item('?', d.text))}
        <Text> </Text>

        {header('Todos', allTodos.length ? `${allTodos.filter(t => t.isDone).length}/${allTodos.length}` : '')}
        {allTodos.length === 0 && empty('No todos yet.')}
        {allTodos.map(t => item(t.isDone ? '✓' : '○', t.text, t.isDone))}
        <Text> </Text>

        <Box flexDirection="row" justifyContent="space-between" width={inner}>
          {header('Links', allLinks.length ? String(allLinks.length) : '')}
          <Button key="clear-links" label="clear" hotkey="l" plain dimColor onPress={() => update($, links, () => [])} />
        </Box>
        {allLinks.length === 0 && empty('Nothing created yet.')}
        {allLinks.map(p => (
          <Text wrap="truncate-middle">
            {'  '}
            <Link href={p.href} label={p.label} />
          </Text>
        ))}
      </Box>
    )
  })
}
