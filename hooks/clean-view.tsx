import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput, Timer } from 'claude-code'

import type { CleanViewChecklist, CleanViewPhase, CleanViewTask } from '../types'

const PLUGIN = 'clean-view'
const PLAN_TOOL = `mcp__${PLUGIN}__plan_steps`
const PROGRESS_TOOL = `mcp__${PLUGIN}__report_progress`
const STORE_KEY = 'cleanViewEnabled'
const TOGGLE_KEY = 'toggle'

const MAX_NAME = 40
const METER_CELLS = 10
const LABEL_CELLS = 7
const TICK_MS = 250
const COLLAPSE_MS = 5000
const FAILURES_UNTIL_STUCK = 3

const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  PLAN_TOOL,
  PROGRESS_TOOL,
])
const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

const PLACEHOLDER_STEPS = ['Understand your request', 'Plan the steps']
const FALLBACK_NAME = 'Working on it'
const FIRST_TITLE = 'Your request'

const NEEDS_OK = 'Claude needs your OK to continue'
const NEEDS_ANSWER = 'Claude has a question for you'
const NEEDS_REPLY = 'Claude is waiting for your reply'
const STUCK_DENIED = 'you said no to a step, so Claude paused'
const STUCK_FAILING = 'a step keeps failing, Claude is trying another way'
const STUCK_REFUSED = "Claude couldn't help with that request"

const CODE_EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|ps1|json|jsonc|ya?ml|toml|ini|cfg|conf|env|lock|md|mdx|html?|css|scss|sass|less|sql|lua|ipynb|vue|svelte|xml|csv|txt|log|dart|scala|ex|exs|pl|r'
const CODE_FILE = new RegExp(`\\S+\\.(?:${CODE_EXTENSIONS})(?![\\w])`, 'gi')

const enabledAtom = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const checklistAtom = atom({ plugin: 'clean-view', key: 'checklist' } as const, null)
const tickAtom = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)

type Engine = EngineInterface

const SYSTEM_SECTION = [
  '# Clean View',
  'The person is using Clean View: tool calls, diffs and command output are hidden from them, and a checklist of your plan sits above the prompt. That checklist is how they follow your work, so keep it honest and readable.',
  `- For every request, even a quick question, call \`plan_steps\` (listed as \`${PLAN_TOOL}\`) first, with every step of the job in order: 2 to 8 short steps. If it is deferred, load it with ToolSearch first. Other tools are refused until a plan exists.`,
  `- Call \`report_progress\` (listed as \`${PROGRESS_TOOL}\`) as real progress happens on the current step, and with percent 100 the moment a step finishes.`,
  '- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".',
  '- Never put file paths, file names, commands, code or tool names in a step name.',
  '- If this session has TodoWrite or TaskCreate, you may use your to-do list as the plan instead; the same naming rules apply to every item.',
].join('\n')

// Module state that need not survive a reload.
let ticker: Timer | undefined
let failuresInARow = 0
let lastErrorKind: string | undefined

/** Turns any name into a short plain-English label. */
export function cleanName(raw: unknown): string {
  let text = String(raw ?? '')
  text = text.replace(/`[^`]*`/g, ' ').replace(/`/g, ' ')
  text = text.replace(/\S*[/\\]\S*/g, ' ')
  text = text.replace(CODE_FILE, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, '')
  text = text.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()

  if (text === '') {
    return FALLBACK_NAME
  }

  text = text[0]!.toUpperCase() + text.slice(1)

  return fitName(text, MAX_NAME)
}

function fitName(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }

  const room = text.slice(0, Math.max(1, limit - 1))
  const lastSpace = room.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(limit / 3) ? room.slice(0, lastSpace) : room

  return cut.replace(/[\s,;:.-]+$/, '') + '…'
}

function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\b(the|a|an|your|my)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  return norm(a) === norm(b)
}

function clampPercent(value: unknown): number {
  const n = Number(value)

  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0
}

function isPlaceholder(list: CleanViewChecklist | null): boolean {
  return list === null || list.tasks.length === 0 || list.tasks.every(t => t.id.startsWith('placeholder-'))
}

function newTask(name: string, id: string, status: CleanViewTask['status']): CleanViewTask {
  return { id, name, status, percent: status === 'done' ? 100 : 0, hasReported: false }
}

function newChecklist(title: string, now: number): CleanViewChecklist {
  return {
    title,
    phase: 'working',
    tasks: PLACEHOLDER_STEPS.map((name, i) => newTask(name, `placeholder-${i}`, i === 0 ? 'active' : 'upcoming')),
    needsYouReason: null,
    stuckReason: null,
    startedAt: now,
    finishedAt: null,
    isCollapsed: false,
  }
}

/** Makes `index` the active step: everything before it done, the rest upcoming. */
function activate(tasks: CleanViewTask[], index: number): CleanViewTask[] {
  return tasks.map((task, i) => {
    if (i < index) {
      return { ...task, status: 'done', percent: 100 }
    }
    if (i === index) {
      return { ...task, status: 'active' }
    }

    return task.status === 'active' ? { ...task, status: 'upcoming' } : task
  })
}

/** Checks off `index` and starts the next unfinished step. */
function finish(tasks: CleanViewTask[], index: number): CleanViewTask[] {
  const next = tasks.map((task, i) =>
    i === index ? { ...task, status: 'done' as const, percent: 100, hasReported: true } : task,
  )
  const following = next.findIndex((task, i) => i > index && task.status !== 'done')

  return following === -1
    ? next
    : next.map((task, i) => (i === following ? { ...task, status: 'active' as const, percent: 0, hasReported: false } : task))
}

export function applyPlan(list: CleanViewChecklist, steps: readonly unknown[]): CleanViewChecklist {
  const names: string[] = []
  for (const step of steps) {
    const name = cleanName(step)
    if (!names.some(n => sameName(n, name))) {
      names.push(name)
    }
  }

  const tasks = names.slice(0, 8).map((name, i) => newTask(name, `plan-${i}`, i === 0 ? 'active' : 'upcoming'))

  return { ...list, tasks }
}

export function applyProgress(list: CleanViewChecklist, rawName: unknown, rawPercent: unknown): CleanViewChecklist {
  const name = cleanName(rawName)
  const percent = clampPercent(rawPercent)
  let tasks = isPlaceholder(list) ? [] : [...list.tasks]
  let index = tasks.findIndex(task => sameName(task.name, name))

  if (index === -1) {
    // A step that isn't in the plan: it takes the current step's place, which waits as "Next".
    const active = tasks.findIndex(task => task.status === 'active')
    const firstOpen = tasks.findIndex(task => task.status !== 'done')
    index = active !== -1 ? active : firstOpen !== -1 ? firstOpen : tasks.length
    tasks.splice(index, 0, newTask(name, `step-${list.tasks.length}-${Date.now() % 100000}`, 'upcoming'))
    tasks = tasks.map((task, i) => (i !== index && task.status === 'active' ? { ...task, status: 'upcoming' } : task))
    tasks = tasks.map((task, i) => (i === index ? { ...task, status: 'active' } : task))
  } else {
    tasks = activate(tasks, index)
  }

  tasks = tasks.map((task, i) => (i === index ? { ...task, percent, hasReported: true } : task))

  if (percent >= 100) {
    tasks = finish(tasks, index)
  }

  return { ...list, tasks }
}

type TodoItem = { content?: unknown; status?: unknown; activeForm?: unknown }

export function applyTodos(list: CleanViewChecklist, todos: readonly TodoItem[]): CleanViewChecklist {
  const previous = isPlaceholder(list) ? [] : list.tasks
  const tasks = todos.map((todo, i): CleanViewTask => {
    const name = cleanName(todo.content)
    const status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : 'upcoming'
    const before = previous.find(task => sameName(task.name, name))
    const percent = status === 'done' ? 100 : status === 'active' ? (before?.percent ?? 0) : 0

    return { id: `todo-${i}`, name, status, percent, hasReported: status === 'active' && (before?.hasReported ?? false) }
  })

  if (tasks.length > 0 && !tasks.some(task => task.status === 'active')) {
    const firstOpen = tasks.findIndex(task => task.status === 'upcoming')
    if (firstOpen !== -1) {
      tasks[firstOpen] = { ...tasks[firstOpen]!, status: 'active' }
    }
  }

  return tasks.length === 0 ? list : { ...list, tasks }
}

function applyTaskCreate(list: CleanViewChecklist, subject: unknown, taskId: string): CleanViewChecklist {
  const tasks = isPlaceholder(list) ? [] : [...list.tasks]
  const name = cleanName(subject)
  const status = tasks.some(task => task.status === 'active') ? 'upcoming' : 'active'
  tasks.push(newTask(name, `task-${taskId}`, status))

  return { ...list, tasks }
}

function applyTaskUpdate(list: CleanViewChecklist, input: Record<string, unknown>): CleanViewChecklist {
  const id = `task-${String(input.taskId ?? input.id ?? '')}`
  let tasks = [...list.tasks]
  let index = tasks.findIndex(task => task.id === id)

  if (index === -1) {
    if (typeof input.subject !== 'string') {
      return list
    }
    tasks.push(newTask(cleanName(input.subject), id, 'upcoming'))
    index = tasks.length - 1
  }

  if (typeof input.subject === 'string') {
    tasks[index] = { ...tasks[index]!, name: cleanName(input.subject) }
  }

  if (input.status === 'deleted') {
    tasks.splice(index, 1)
  } else if (input.status === 'completed') {
    tasks = finish(tasks, index)
  } else if (input.status === 'in_progress') {
    tasks = tasks.map((task, i) =>
      i === index ? { ...task, status: 'active' } : task.status === 'active' ? { ...task, status: 'upcoming' } : task,
    )
  } else if (input.status === 'pending') {
    tasks[index] = { ...tasks[index]!, status: 'upcoming', percent: 0 }
  }

  return { ...list, tasks }
}

function taskIdFrom(result: unknown, text: string | undefined): string {
  const record = (result ?? {}) as { task?: { id?: unknown }; id?: unknown; taskId?: unknown }
  const direct = record.task?.id ?? record.id ?? record.taskId

  if (direct !== undefined && direct !== null) {
    return String(direct)
  }

  return /#?(\d+)/.exec(text ?? '')?.[1] ?? String(Date.now() % 100000)
}

export function plainError(kind: string | undefined, text: string): string {
  const k = (kind ?? '').toLowerCase()
  const t = text.toLowerCase()

  if (k === 'rate_limit' || /rate.?limit|usage limit|429|quota/.test(t)) {
    return 'you hit your usage limit, try again a little later'
  }
  if (k === 'overloaded' || /overloaded|529|server.*busy/.test(t)) {
    return "Claude's servers are busy, try again in a minute"
  }
  if (/prompt is too long|context.{0,20}(too long|limit|window)|too many tokens/.test(t)) {
    return 'the conversation got too long, type /compact and try again'
  }
  if (
    k === 'authentication_failed' ||
    k === 'oauth_org_not_allowed' ||
    k === 'cloud_credential_error' ||
    /auth|log ?in|401|403|api key|credential|token (expired|revoked)/.test(t)
  ) {
    return 'you need to sign in again, type /login'
  }
  if (/econn|enotfound|etimedout|network|fetch failed|socket|connection|offline|timed out/.test(t)) {
    return 'the internet connection dropped'
  }
  if (k === 'invalid_request' && /long|token/.test(t)) {
    return 'the conversation got too long, type /compact and try again'
  }

  return "something went wrong on Claude's side, try again"
}

function isUserDenial(text: string | undefined): boolean {
  return /doesn't want to proceed|tool use was rejected|user rejected|user denied|user declined/i.test(text ?? '')
}

function isTicking(phase: CleanViewPhase | undefined): boolean {
  return phase === 'working' || phase === 'needsYou'
}

function syncTicker($: Engine, list: CleanViewChecklist | null) {
  const shouldTick = list !== null && isTicking(list.phase)

  if (shouldTick && ticker === undefined) {
    ticker = $.clock.every(TICK_MS, () => {
      void update($, tickAtom, n => (n + 1) % 1_000_000)
    })
  } else if (!shouldTick && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

async function change($: Engine, fn: (list: CleanViewChecklist) => CleanViewChecklist | null) {
  const next = await update($, checklistAtom, list => (list === null ? null : fn(list)))
  syncTicker($, next)

  return next
}

async function setChecklist($: Engine, list: CleanViewChecklist | null) {
  await update($, checklistAtom, () => list)
  syncTicker($, list)
}

async function ensureJob($: Engine) {
  const list = await read($, checklistAtom)
  if (list !== null && list.phase !== 'done' && list.phase !== 'stopped') {
    return
  }
  await setChecklist($, newChecklist(FIRST_TITLE, await $.clock.now()))
}

async function setEnabled($: Engine, isOn: boolean) {
  await update($, enabledAtom, () => isOn)
  try {
    await $.store.set(STORE_KEY, isOn)
  } catch {
    // Remembering is best effort; the session still has the setting.
  }
  $.ui.toast(isOn ? 'Clean View is on: technical details are hidden' : 'Clean View is off: showing everything')
}

function nameJob($: Engine, prompt: string, startedAt: number) {
  const ask = [
    'Give this job a short name for a non-technical person: 2 to 6 plain words, starting with a verb.',
    'No file names, code, commands or quotes. Reply with the name only.',
    '',
    'Request:',
    prompt.slice(0, 2000),
  ].join('\n')

  $.clock.after(0, () => {
    void (async () => {
      const request = { model: 'haiku', prompt: ask, maxTokens: 30, timeoutMs: 15000 }
      let reply
      try {
        reply = await $.model.complete({ ...request, effort: 'low' })
      } catch {
        try {
          reply = await $.model.complete(request)
        } catch {
          return
        }
      }
      if (!reply.isAnswered) {
        return
      }

      const words = reply.text.replace(/["'“”‘’*_#.]/g, '').trim().split(/\s+/).slice(0, 6).join(' ')
      const title = cleanName(words)
      if (title === FALLBACK_NAME) {
        return
      }

      await update($, checklistAtom, list => (list !== null && list.startedAt === startedAt ? { ...list, title } : list))
    })()
  })
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function meter(task: CleanViewTask, tick: number, isPaused: boolean): string {
  if (task.status === 'done') {
    return '█'.repeat(METER_CELLS)
  }
  if (task.status === 'upcoming') {
    return '░'.repeat(METER_CELLS)
  }
  if (task.hasReported || isPaused) {
    const filled = Math.round((task.percent / 100) * METER_CELLS)

    return '█'.repeat(filled) + '░'.repeat(METER_CELLS - filled)
  }

  const span = METER_CELLS + 3
  const head = tick % span

  return Array.from({ length: METER_CELLS }, (_, i) => (i <= head && i > head - 3 ? '█' : '░')).join('')
}

function rowLabel(task: CleanViewTask, upcomingIndex: number, isPaused: boolean): string {
  if (task.status === 'done') {
    return 'Done'
  }
  if (task.status === 'active') {
    return task.hasReported ? `${task.percent}%` : isPaused ? 'Paused' : 'Working'
  }

  return upcomingIndex === 0 ? 'Next' : 'Up next'
}

/** Draws a technical transcript row as nothing while Clean View is on. */
async function hideRow($: Engine, e: RenderInput, drawAsUsual: () => Promise<RenderElement>): Promise<RenderElement> {
  if (!(await read($, enabledAtom))) {
    return drawAsUsual()
  }
  const { Box } = $.ui.resolve(e)

  return <Box display="none" />
}

export function registerCleanView(on: On) {
  on('session.start', async ($, e, next) => {
    try {
      const stored = await $.store.get(STORE_KEY)
      await update($, enabledAtom, () => stored !== false)
    } catch {
      // Starts on when nothing was remembered.
    }

    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front, before any other tool: 2 to 8 short plain-English step names in order, each under 40 characters and starting with a verb (no file names, paths, code or tool names). The first step starts right away.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
            description: 'Step names in order, e.g. "Build the pricing section".',
          },
        },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step of the plan. Call it as real progress happens, and with percent 100 the moment a step finishes; the next step then starts by itself. Use the step name exactly as planned.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The step name, as given to plan_steps.' },
          percent: { type: 'number', minimum: 0, maximum: 100, description: 'How far along this step is, 0 to 100.' },
        },
        required: ['task', 'percent'],
      },
    })
    await $.command.register({
      name: 'simple',
      description: 'Turn Clean View on or off (no argument flips it)',
      argumentHint: 'on|off',
    })

    syncTicker($, await read($, checklistAtom))

    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Use /simple on, /simple off, or just /simple to flip it.' }
    }

    const isOn = arg === '' ? !(await read($, enabledAtom)) : arg === 'on'
    await setEnabled($, isOn)

    return { text: isOn ? 'Clean View is on.' : 'Clean View is off.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabledAtom))) {
      return composed
    }

    return {
      ...composed,
      sections: [
        ...composed.sections.filter(section => section.id !== `${PLUGIN}:checklist`),
        { id: `${PLUGIN}:checklist`, text: SYSTEM_SECTION, scope: 'session' as const },
      ],
    }
  })

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()
    if (text !== '' && !text.startsWith('/')) {
      const list = await read($, checklistAtom)
      const isResuming =
        list !== null && (list.phase === 'needsYou' || list.phase === 'stuck') && !isPlaceholder(list)

      if (isResuming) {
        failuresInARow = 0
        await change($, current => ({ ...current, phase: 'working', needsYouReason: null, stuckReason: null }))
      } else {
        const startedAt = await $.clock.now()
        failuresInARow = 0
        lastErrorKind = undefined
        await setChecklist($, newChecklist(FIRST_TITLE, startedAt))
        nameJob($, text, startedAt)
      }
    }

    return next(e)
  })

  on('tool.call', { tool: 'mcp__clean-view__plan_steps' }, async ($, e) => {
    const raw = (e as unknown as { steps?: unknown }).steps
    const steps: unknown[] = Array.isArray(raw) ? raw : []
    if (steps.length === 0) {
      return { result: 'Give plan_steps at least one step name.' }
    }

    await ensureJob($)
    const list = await change($, current => applyPlan(current, steps))

    return { result: `Planned ${list?.tasks.length ?? steps.length} steps. The first one has started.` }
  }).catch(() => ({ result: 'Planned the steps. The first one has started.' }))

  on('tool.call', { tool: 'mcp__clean-view__report_progress' }, async ($, e) => {
    const input = e as { task?: unknown; percent?: unknown }
    const percent = clampPercent(input.percent)

    await ensureJob($)
    await change($, current => applyProgress(current, input.task, percent))

    return { result: `Progress noted: ${percent}%.` }
  }).catch(() => ({ result: 'Progress noted.' }))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const tool = String(e.tool)
    const isOn = await read($, enabledAtom)

    if (isOn && !ALWAYS_ALLOWED.has(tool) && isPlaceholder(await read($, checklistAtom))) {
      return {
        deny: `Clean View: call plan_steps (${PLAN_TOOL}) first to lay out the steps of this job in plain English. Load it with ToolSearch if it is deferred, then try again.`,
      }
    }

    await change($, list =>
      list.phase === 'needsYou' ? { ...list, phase: 'working', needsYouReason: null } : list,
    )

    if (tool === 'AskUserQuestion') {
      await change($, list =>
        list.phase === 'done' || list.phase === 'stopped'
          ? list
          : { ...list, phase: 'needsYou', needsYouReason: NEEDS_ANSWER },
      )
    }

    const ran = await next(e)

    await change($, list =>
      list.phase === 'needsYou' && list.needsYouReason !== NEEDS_REPLY
        ? { ...list, phase: 'working', needsYouReason: null }
        : list,
    )

    if (ran.deny !== undefined) {
      return ran
    }

    if (ran.isError === true) {
      if (isUserDenial(ran.text)) {
        failuresInARow = 0
        await change($, list => ({ ...list, phase: 'stuck', stuckReason: STUCK_DENIED }))
      } else if (tool !== PLAN_TOOL && tool !== PROGRESS_TOOL) {
        failuresInARow += 1
        if (failuresInARow >= FAILURES_UNTIL_STUCK) {
          await change($, list =>
            list.phase === 'working' ? { ...list, phase: 'stuck', stuckReason: STUCK_FAILING } : list,
          )
        }
      }

      return ran
    }

    failuresInARow = 0
    await change($, list =>
      list.phase === 'stuck' ? { ...list, phase: 'working', stuckReason: null } : list,
    )

    if (TODO_TOOLS.has(tool)) {
      const input = e as unknown as Record<string, unknown>
      await ensureJob($)
      if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
        await change($, list => applyTodos(list, input.todos as TodoItem[]))
      } else if (tool === 'TaskCreate') {
        const id = taskIdFrom(ran.result, ran.text)
        await change($, list => applyTaskCreate(list, input.subject ?? input.description, id))
      } else if (tool === 'TaskUpdate') {
        await change($, list => applyTaskUpdate(list, input))
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    const kind = String(e.notification_type ?? '')
    const isAsking = /permission|elicitation|question/i.test(kind) || /permission|approve|needs your/i.test(e.message ?? '')

    if (isAsking) {
      await change($, list =>
        list.phase === 'done' || list.phase === 'stopped'
          ? list
          : { ...list, phase: 'needsYou', needsYouReason: /question|elicitation/i.test(kind) ? NEEDS_ANSWER : NEEDS_OK },
      )
    }

    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    await change($, list =>
      list.phase === 'done' || list.phase === 'stopped' ? list : { ...list, phase: 'stuck', stuckReason: STUCK_DENIED },
    )

    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    lastErrorKind = String(e.error)
    const reason = plainError(e.error, `${e.error_details ?? ''} ${e.last_assistant_message ?? ''}`)
    await change($, list =>
      list.phase === 'done' || list.phase === 'stopped' ? list : { ...list, phase: 'stuck', stuckReason: reason },
    )

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const list = await read($, checklistAtom)
    if (list === null || list.phase === 'done' || list.phase === 'stopped') {
      return next(e)
    }

    const now = await $.clock.now()
    const errorKind = lastErrorKind
    lastErrorKind = undefined

    if (e.reason === 'error') {
      const reason = plainError(errorKind, e.answer)
      await change($, current => ({ ...current, phase: 'stuck', stuckReason: reason, needsYouReason: null }))
    } else if (e.reason === 'refusal') {
      await change($, current => ({ ...current, phase: 'stuck', stuckReason: STUCK_REFUSED, needsYouReason: null }))
    } else if (list.phase === 'stuck' && list.stuckReason === STUCK_DENIED) {
      await change($, current => current)
    } else if (e.isAborted || e.reason === 'aborted') {
      await change($, current => ({ ...current, phase: 'stopped', needsYouReason: null, stuckReason: null, finishedAt: now }))
    } else if (!isPlaceholder(list) && list.tasks.some(task => task.status !== 'done')) {
      await change($, current => ({ ...current, phase: 'needsYou', needsYouReason: NEEDS_REPLY, stuckReason: null }))
      syncTicker($, null)
    } else {
      const startedAt = list.startedAt
      await change($, current => ({
        ...current,
        phase: 'done',
        tasks: current.tasks.map(task => ({ ...task, status: 'done' as const, percent: 100 })),
        needsYouReason: null,
        stuckReason: null,
        finishedAt: now,
      }))
      $.clock.after(COLLAPSE_MS, () => {
        void update($, checklistAtom, current =>
          current !== null && current.startedAt === startedAt && current.phase === 'done'
            ? { ...current, isCollapsed: true }
            : current,
        )
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, ($, e, next) => hideRow($, e, () => next(e)))
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => hideRow($, e, () => next(e)))
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => hideRow($, e, () => next(e)))

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabledAtom)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)
    const above = await next(e)

    return (
      <Box flexDirection="column">
        {above}
        {await drawBand($, e)}
      </Box>
    )
  })
}

/** Draws the toggle and the checklist; another plugin's band, if any, stacks above it. */
async function drawBand($: Engine, e: RenderInput<'AbovePrompt'>): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isOn = await read($, enabledAtom)
  const list = isOn ? await read($, checklistAtom) : null
  const tick = list !== null && isTicking(list.phase) ? await read($, tickAtom) : 0
  const columns = Math.max(24, e.props.bodyColumns)

  const toggle = (
    <Button
      key={TOGGLE_KEY}
      label={isOn ? '● Clean View: ON' : '○ Clean View: OFF'}
      variant={isOn ? 'primary' : 'secondary'}
      onPress={() => setEnabled($, !isOn)}
    />
  )

  if (list === null) {
    return (
      <Box flexDirection="row" justifyContent="flex-end" width={columns}>
        {toggle}
      </Box>
    )
  }

  const now = await $.clock.now()
  const elapsed = formatDuration((list.finishedAt ?? now) - list.startedAt)
  const isPaused = list.phase !== 'working'

  let header
  if (list.phase === 'needsYou') {
    header = (
      <Box flexDirection="row" flexGrow={1} flexShrink={1} gap={1}>
        <Text backgroundColor="warning" color="inverseText" bold>
          {' Needs you '}
        </Text>
        <Text wrap="truncate-end">{list.needsYouReason ?? NEEDS_REPLY}</Text>
      </Box>
    )
  } else if (list.phase === 'stuck') {
    header = (
      <Text color="warning" wrap="truncate-end">
        ⚠ Stuck: {list.stuckReason ?? STUCK_FAILING}
      </Text>
    )
  } else if (list.phase === 'stopped') {
    header = (
      <Text wrap="truncate-end">
        ■ Stopped · {list.title} · you pressed Esc
      </Text>
    )
  } else if (list.phase === 'done') {
    header = (
      <Text color="success" wrap="truncate-end">
        ✓ All done · {list.title} · took {elapsed}
      </Text>
    )
  } else {
    header = (
      <Text wrap="truncate-end">
        <Text bold>{list.title}</Text> · {elapsed}
      </Text>
    )
  }

  // A blank row and a rule set the checklist apart from the transcript above it.
  const divider = (
    <Box key="divider" marginTop={1}>
      <Text dimColor wrap="truncate-end">
        {'─'.repeat(columns)}
      </Text>
    </Box>
  )

  const headerRow = (
    <Box key="header" flexDirection="row" justifyContent="space-between" width={columns}>
      <Box flexGrow={1} flexShrink={1}>
        {header}
      </Box>
      {toggle}
    </Box>
  )

  if (list.phase === 'done' && list.isCollapsed) {
    return (
      <Box flexDirection="column" width={columns}>
        {divider}
        {headerRow}
      </Box>
    )
  }

  const nameColumn = Math.max(6, Math.min(MAX_NAME, columns - 2 - 1 - METER_CELLS - 1 - LABEL_CELLS - 1))
  let upcomingSeen = 0

  const rows = list.tasks.map(task => {
    const upcomingIndex = task.status === 'upcoming' ? upcomingSeen++ : -1
    const name = fitName(task.name, nameColumn).padEnd(nameColumn)
    const bar = meter(task, tick, isPaused)
    const label = rowLabel(task, upcomingIndex, list.phase === 'needsYou' || list.phase === 'stuck')

    if (task.status === 'done') {
      return (
        <Box key={`row-${task.id}`} flexDirection="row">
          <Text color="success">✓ </Text>
          <Text dimColor>{name} </Text>
          <Text color="success">{bar}</Text>
          <Text dimColor> {label}</Text>
        </Box>
      )
    }

    if (task.status === 'active') {
      return (
        <Box key={`row-${task.id}`} flexDirection="row">
          <Text color={list.phase === 'needsYou' ? 'warning' : 'claude'}>{list.phase === 'needsYou' ? '‖ ' : '▶ '}</Text>
          <Text bold>{name} </Text>
          <Text color="claude">{bar}</Text>
          <Text> {label}</Text>
        </Box>
      )
    }

    return (
      <Box key={`row-${task.id}`} flexDirection="row">
        <Text dimColor>○ </Text>
        <Text dimColor>{name} </Text>
        <Text dimColor>{bar}</Text>
        <Text dimColor> {label}</Text>
      </Box>
    )
  })

  return (
    <Box flexDirection="column" width={columns}>
      {divider}
      {headerRow}
      {rows}
    </Box>
  )
}
