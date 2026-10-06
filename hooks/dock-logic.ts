import type { DockCounts, DockHelper, DockHelperModel, DockMission } from '../types'

// Everything here is `$`-free so tests can call it directly.

export const MIN_SIZE = 1
export const MAX_SIZE = 10
export const SIZES: readonly number[] = Array.from({ length: MAX_SIZE }, (_, i) => i + 1)

const JOB_CHARS = 40
const TASK_WORDS = 5
const TASK_CHARS = 32

/** A Team Size typed by the person: a whole number from 1 to 10, else null. */
export function parseSize(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) {
    return null
  }
  const size = Number(text)

  return size >= MIN_SIZE && size <= MAX_SIZE ? size : null
}

/** A saved size, or 1 when nothing usable was saved. */
export function sizeFrom(value: unknown): number {
  const size = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN

  return Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE ? size : MIN_SIZE
}

/** One step left or right on the Team Size control, held to 1..10. */
export function stepSize(size: number, delta: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, size + delta))
}

function fit(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  const room = text.slice(0, limit - 1)
  const lastSpace = room.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(limit / 3) ? room.slice(0, lastSpace) : room

  return cut.replace(/[\s,;:.-]+$/, '') + '…'
}

function capitalize(text: string): string {
  return text === '' ? text : text[0]!.toUpperCase() + text.slice(1)
}

/** The mission's name: the first clause of the request, about 40 characters. */
export function jobName(request: string): string {
  const flat = request.replace(/`[^`]*`/g, ' ').replace(/\s+/g, ' ').trim()
  const clause = flat.split(/[.?!;:\n]|,\s|\s[-–—]\s/)[0]?.trim() ?? ''
  const name = clause.replace(/^(please|can you|could you|would you|hey|hi)[\s,]+/i, '').trim()

  return name === '' ? 'Your request' : capitalize(fit(name, JOB_CHARS))
}

/** A helper's task name: its 3 to 5 word description, tidied. */
export function taskName(description: unknown): string {
  const words = String(description ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word !== '')
    .slice(0, TASK_WORDS)
  const name = words.join(' ')

  return name === '' ? 'Helper' : capitalize(fit(name, TASK_CHARS))
}

/** Two letters for a helper's badge: from the part after a colon when there is one. */
export function initials(name: string): string {
  const focus = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const words = focus.match(/[A-Za-z0-9]+/g) ?? name.match(/[A-Za-z0-9]+/g) ?? []
  if (words.length === 0) {
    return '··'
  }
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase().padEnd(2, '·')
  }

  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

/** Names two task names the same when they differ only in case, spacing and punctuation. */
export function sameTask(a: string, b: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  return norm(a) === norm(b)
}

export function infoLine(size: number): string {
  return size <= 1 ? 'Claude decides how many helpers' : `Splits each request across ${size} helpers  ·  all run at once`
}

/** The context added to every request above size 1. */
export function splitInstruction(size: number): string {
  return [
    `# Agent Dock: Team Size ${size}`,
    `Split this request into exactly ${size} independent pieces and launch one helper (the Agent tool) per piece, all in one message so they run in parallel.`,
    'Find a real split, one helper per item (per store, per task, per file, per section). Never argue that it cannot be split and never pad with useless work.',
    'Give each helper a short plain-English description of 3 to 5 words, e.g. "Price check: Panera".',
    'In each helper\'s prompt add: "As you work, call report_progress with your task name and a percent at about 25, 50, 75 and 100. Do not call plan_steps."',
    'When they finish, combine their results into one answer.',
  ].join('\n')
}

export function capMessage(size: number): string {
  return `Team Size is ${size}: this request already has ${size} helpers. Finish with the helpers you have.`
}

export function nudgeText(used: number, size: number): string {
  return `You used ${used} of ${size} helpers. Split the remaining work across the other ${size - used}, one helper per piece, all in parallel.`
}

export function isNudge(text: string): boolean {
  return /^You used \d+ of \d+ helpers\. Split the remaining work/.test(text.trim())
}

export function newMission(job: string, now: number): DockMission {
  return { job, startedAt: now, helpers: [], agentCalls: 0, isNudged: false, isStopped: false }
}

export function newHelper(id: string, description: unknown, status: DockHelper['status'], now: number): DockHelper {
  return {
    id,
    name: taskName(description),
    status,
    percent: 0,
    hasReported: false,
    startedAt: status === 'queued' ? null : now,
    finishedAt: null,
    agentId: null,
  }
}

export function patchHelper(mission: DockMission, id: string, fn: (helper: DockHelper) => DockHelper): DockMission {
  return { ...mission, helpers: mission.helpers.map(helper => (helper.id === id ? fn(helper) : helper)) }
}

/**
 * Moves a helper's meter for its report_progress call: the helper already tied
 * to that agent, else a working one whose task name matches, else the first
 * working one not yet tied to an agent. Holds a working meter under 100 until
 * its Agent call returns.
 */
export function applyHelperProgress(mission: DockMission, agentId: string, task: string, percent: number): DockMission {
  const working = mission.helpers.filter(helper => helper.status === 'working')
  const target =
    mission.helpers.find(helper => helper.agentId === agentId) ??
    working.find(helper => helper.agentId === null && sameTask(helper.name, task)) ??
    working.find(helper => helper.agentId === null)
  if (target === undefined) {
    return mission
  }

  return patchHelper(mission, target.id, helper => ({
    ...helper,
    agentId,
    percent: helper.status === 'working' ? Math.min(clampPercent(percent), 99) : helper.percent,
    hasReported: true,
  }))
}

/** Adds a queued card for each Agent call in a response's blocks, before any of them runs. */
export function queueHelpers(mission: DockMission, content: readonly unknown[], now: number): DockMission {
  const calls = content.filter(
    (block): block is { type: 'tool_use'; id: string; name: string; input?: { description?: unknown } } =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_use' &&
      (block as { name?: unknown }).name === 'Agent',
  )
  const fresh = calls
    .filter(call => !mission.helpers.some(helper => helper.id === call.id))
    .map(call => newHelper(call.id, call.input?.description, 'queued', now))

  return fresh.length === 0 ? mission : { ...mission, helpers: [...mission.helpers, ...fresh] }
}

export function counts(helpers: readonly DockHelper[]): DockCounts {
  const of = (status: DockHelper['status']) => helpers.filter(helper => helper.status === status).length

  return { working: of('working'), queued: of('queued'), done: of('done'), stuck: of('stuck') }
}

export function isLive(mission: DockMission | null): boolean {
  return mission !== null && mission.helpers.some(helper => helper.status === 'queued' || helper.status === 'working')
}

export function isComplete(mission: DockMission | null): boolean {
  return mission !== null && mission.helpers.length > 0 && !isLive(mission)
}

/** The folded dock's status-bar badge. */
export function badge(c: DockCounts): string {
  const parts = [`${c.working} working`, `${c.queued} queued`, `${c.done} done`]
  if (c.stuck > 0) {
    parts.push(`${c.stuck} stuck`)
  }

  return `◆ ${parts.join(' · ')}`
}

/** A timer: m:ss, or h:mm:ss past an hour. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** A duration in words for the summary: 45s, 2m 14s, 1h 3m. */
export function duration(ms: number): string {
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

export function missionEnd(mission: DockMission, now: number): number {
  if (isLive(mission)) {
    return now
  }
  const ends = mission.helpers.map(helper => helper.finishedAt ?? now)

  return ends.length === 0 ? now : Math.max(...ends)
}

export function summary(mission: DockMission, now: number): string {
  const c = counts(mission.helpers)
  const total = mission.helpers.length
  const noun = total === 1 ? 'agent' : 'agents'
  const took = duration(missionEnd(mission, now) - mission.startedAt)
  const stuck = c.stuck > 0 ? ` (${c.stuck} got stuck)` : ''

  return `${total} ${noun} finished ${mission.job} in ${took}${stuck}`
}

/** One helper's share of the mission: done and stuck count whole. */
export function helperPercent(helper: DockHelper): number {
  if (helper.status === 'done' || helper.status === 'stuck') {
    return 100
  }

  return helper.status === 'working' ? helper.percent : 0
}

export function missionPercent(helpers: readonly DockHelper[]): number {
  if (helpers.length === 0) {
    return 0
  }

  return Math.round(helpers.reduce((sum, helper) => sum + helperPercent(helper), 0) / helpers.length)
}

export function clampPercent(value: unknown): number {
  const n = Number(value)

  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0
}

/** A meter's filled cells for a percent. */
export function filledCells(percent: number, width: number): number {
  return Math.round((clampPercent(percent) / 100) * Math.max(0, width))
}

/** Where the moving sweep's head sits on a meter at this tick. */
export function sweepHead(tick: number, width: number): number {
  return tick % (Math.max(1, width) + 4)
}

/** The mission bar's three spans: done, working, rest. */
export function missionSpans(helpers: readonly DockHelper[], width: number): { done: number; working: number } {
  if (helpers.length === 0) {
    return { done: 0, working: 0 }
  }
  const finished = helpers.filter(helper => helper.status === 'done' || helper.status === 'stuck').length
  const done = Math.round((finished / helpers.length) * width)
  const all = filledCells(missionPercent(helpers), width)

  return { done, working: Math.max(0, all - done) }
}

/** How many cards share a row at this width. */
export function cardsPerRow(columns: number): number {
  return columns >= 100 ? 3 : columns >= 62 ? 2 : 1
}

// ---- Phase 2: helper model ------------------------------------------------

export type ModelStep = { family: 'haiku' | 'sonnet' | 'opus' | 'fable'; label: string }

/** Lowest first: one step down is one place to the left. */
export const MODEL_LADDER: readonly ModelStep[] = [
  { family: 'haiku', label: 'Haiku 4.5' },
  { family: 'sonnet', label: 'Sonnet 5.5' },
  { family: 'opus', label: 'Opus 5.5' },
  { family: 'fable', label: 'Fable 5.1' },
]

export const EFFORT_LADDER: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const HELPER_MODELS: readonly { value: DockHelperModel; label: string }[] = [
  { value: 'fast', label: 'Fast & Cheap' },
  { value: 'same', label: 'Same as me' },
  { value: 'stepDown', label: 'One step down' },
]

export function helperModelFrom(value: unknown): DockHelperModel {
  const text = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (text === 'fast' || text === 'fastcheap' || text === 'cheap') {
    return 'fast'
  }
  if (text === 'stepdown' || text === 'down' || text === 'onestepdown') {
    return 'stepDown'
  }

  return 'same'
}

/** Which ladder rung a model name (an id, an alias, a display name) is. */
export function modelStep(name: string | null | undefined): ModelStep | null {
  const lower = String(name ?? '').toLowerCase()

  return MODEL_LADDER.find(step => lower.includes(step.family)) ?? null
}

/** One model tier down; Haiku is the floor. Answers the label. */
export function stepDownModel(name: string): string {
  const index = MODEL_LADDER.findIndex(step => step.family === modelStep(name)?.family)
  if (index === -1) {
    return name
  }

  return MODEL_LADDER[Math.max(0, index - 1)]!.label
}

/** One effort level down; low is the floor. */
export function stepDownEffort(effort: string): string {
  const index = EFFORT_LADDER.indexOf(effort.toLowerCase())

  return index === -1 ? effort : EFFORT_LADDER[Math.max(0, index - 1)]!
}

/** The model alias the Agent tool takes for a helper under this setting, or null to leave it. */
export function helperModelAlias(choice: DockHelperModel, sessionModel: string | null): ModelStep['family'] | null {
  if (choice === 'fast') {
    return 'haiku'
  }
  const current = modelStep(sessionModel)
  if (current === null) {
    return null
  }

  return choice === 'same' ? current.family : modelStep(stepDownModel(current.label))!.family
}

/**
 * The caption under the Helpers toggle, naming the model and effort helpers get.
 * The Agent tool takes a model per helper but no effort, so helpers keep the
 * session's effort and the caption says so whenever it would differ.
 */
export function helperCaption(choice: DockHelperModel, sessionModel: string | null, sessionEffort: string | null): string {
  const alias = helperModelAlias(choice, sessionModel)
  const model = alias === null ? 'your model' : MODEL_LADDER.find(step => step.family === alias)!.label
  if (alias === 'haiku') {
    return `Helpers run on ${model} · no effort setting`
  }
  if (choice === 'same') {
    return `Helpers run on ${model} · ${sessionEffort ?? 'your'} effort`
  }

  return `Helpers run on ${model} · effort inherited`
}
