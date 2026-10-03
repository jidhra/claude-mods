import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pin, Todo } from '../types'

const PANE = 'pinboard'
const TITLE = 'Pinboard'

const asks = atom({ plugin: 'pinboard', key: 'asks' } as const, [] as string[])
const todos = atom({ plugin: 'pinboard', key: 'todos' } as const, [] as Todo[])
const links = atom({ plugin: 'pinboard', key: 'links' } as const, [] as Pin[])

const TODO_FORMAT =
  'When you lay out a task list for the work, write it as Markdown checkboxes (`- [ ] item`), and when items finish, list them again as `- [x] item` with the same wording.'

// Lines of prose: fenced code, quotes and tables dropped
function proseLines(text: string): string[] {
  let inFence = false
  return text.split('\n').filter(line => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    else if (!inFence && !/^\s*[>|]/.test(line)) return true
    return false
  })
}

const clean = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()

export const questionsIn = (text: string): string[] =>
  [...new Set(proseLines(text).map(clean).filter(line => /\?\)?$/.test(line)))]

export const todosIn = (text: string): Todo[] =>
  proseLines(text).flatMap(line => {
    const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line)
    return m ? [{ text: clean(m[2] ?? ''), isDone: m[1] !== ' ' }] : []
  })

// Same wording updates an item; new wording appends
export function mergeTodos(old: Todo[], fresh: Todo[]): Todo[] {
  const merged = old.map(t => fresh.find(f => f.text === t.text) ?? t)
  return [...merged, ...fresh.filter(f => !old.some(t => t.text === f.text))]
}

const URL = /https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9\-._~:/?#[\]!$&'()*+,;=%@]*)?/g

export const urlPins = (text: string): Pin[] =>
  [...new Set([...text.matchAll(URL)].map(m => m[0].replace(/[)\].,;:'!?*]+$/, '')))]
    .filter(href => !href.includes('@') && href.length <= 2048)
    .map(href => {
      const gh = /github\.com\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/.exec(href)
      return { href, label: gh ? `${gh[1]} ${gh[2] === 'pull' ? 'PR' : 'issue'} #${gh[3]}` : href.slice(8) }
    })

const isEmpty = async ($: EngineInterface) =>
  (await read($, asks)).length + (await read($, todos)).length + (await read($, links)).length === 0

// Runs a capture; opens the pane when it puts the first thing on an empty board
async function capture($: EngineInterface, change: () => Promise<unknown>): Promise<void> {
  const wasEmpty = await isEmpty($)
  await change()
  if (wasEmpty && !(await isEmpty($))) await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pinboard', description: 'Open the pane of open questions, todos and links', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'pinboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return {}
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'pinboard:todos', text: TODO_FORMAT, scope: 'session' }] }
  })

  // A tool result with a few links made or touched them; a long list is a listing
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || !('text' in ran) || ran.isError) return ran
    const found = urlPins(ran.text ?? '')
    if (found.length > 0 && found.length <= 3) {
      await capture($, () => update($, links, old => [...found, ...old.filter(p => !found.some(f => f.href === p.href))].slice(0, 12)))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || e.isAborted) return done
    await capture($, async () => {
      // Each reply's questions replace the last reply's
      await update($, asks, () => questionsIn(e.answer))
      const fresh = todosIn(e.answer)
      if (fresh.length > 0) await update($, todos, old => mergeTodos(old, fresh))
    })
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    // One cell of padding on every side
    const inner = Math.max(10, e.props.bodyColumns - 2)
    const allAsks = await read($, asks)
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
        {header('Waiting on you', allAsks.length ? String(allAsks.length) : '')}
        {allAsks.length === 0 && empty('No open questions.')}
        {allAsks.map(q => item('?', q))}
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
