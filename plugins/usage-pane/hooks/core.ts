import type { Baseline, Limit, LocalStats, SessionTotals } from '../types'

export const EMPTY_SESSION: SessionTotals = {
  startedAt: null,
  costUsd: null,
  inTok: 0,
  outTok: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turns: 0,
  prompts: 0,
  byModel: {},
  ctxPct: null,
}

/**
 * Moves each window's baseline to the new reading. A window seen for the first
 * time starts at its current figure; one whose reset time changed folds what
 * the session used of the old period into `carried` and starts again from 0.
 */
export function advanceBaselines(old: Record<string, Baseline>, limits: readonly Limit[]): Record<string, Baseline> {
  const out: Record<string, Baseline> = { ...old }
  for (const l of limits) {
    const b = out[l.kind]
    if (!b) {
      out[l.kind] = { startPct: l.pct, resetsAt: l.resetsAt, lastPct: l.pct, carried: 0 }
    } else if (l.resetsAt && b.resetsAt && l.resetsAt !== b.resetsAt) {
      out[l.kind] = { startPct: 0, resetsAt: l.resetsAt, lastPct: l.pct, carried: b.carried + Math.max(0, b.lastPct - b.startPct) }
    } else {
      out[l.kind] = { ...b, resetsAt: b.resetsAt ?? l.resetsAt, lastPct: l.pct }
    }
  }
  return out
}

/** How many points of a window moved since this session began, one decimal. */
export function sessionShare(b: Baseline | undefined): number {
  if (!b) return 0
  return Math.round((b.carried + Math.max(0, b.lastPct - b.startPct)) * 10) / 10
}

/** The windows in display order: 5-hour, then 7-day, then anything model-scoped. */
export function sortLimits(limits: readonly Limit[]): Limit[] {
  const rank = (k: string) => (/five|5h/i.test(k) ? 0 : /^seven_day$|^7d$/i.test(k) ? 1 : 2)
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind))
}

/** `five_hour` → `Session (5h)`, `seven_day` → `Weekly`, `seven_day_opus` → `Opus weekly`, as /status names them. */
export function limitTitle(kind: string): string {
  if (/^five[_ -]?hours?$/i.test(kind)) return 'Session (5h)'
  if (/^seven[_ -]?days?$/i.test(kind)) return 'Weekly'
  const scoped = /^seven[_ -]?days?[_ -](.+)$/i.exec(kind)
  if (scoped) return `${cap(scoped[1]!.replace(/[_-]+/g, ' '))} weekly`
  return cap(kind.replace(/[_-]+/g, ' '))
}

/** A window's short name for the title line: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
export const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** A gauge of `width` cells: ▰ filled, ▱ empty. */
export const gauge = (pct: number, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

/** The theme colour a percentage reads in: calm, then warning from 70, error from 90. */
export const levelColor = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'claude')

export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/** 950 → `950`, 48_200 → `48k`, 1_234_567 → `1.2M`. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

/** Milliseconds as `2h 10m`, `4d 3h`, `12m`, `<1m`. */
export function fmtSpan(ms: number): string {
  if (ms < 60_000) return '<1m'
  const m = Math.floor(ms / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

/** The time until a window resets, or '' without a reset time. */
export function untilReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  return Number.isFinite(at) ? fmtSpan(Math.max(0, at - now)) : ''
}

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`. */
export function modelName(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i.exec(id)
  if (!m) return id
  return `${cap(m[1]!)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

/** Each model's share of the session's tokens, largest first, as whole percentages. */
export function modelMix(byModel: Record<string, number>): { name: string; pct: number }[] {
  const total = Object.values(byModel).reduce((a, b) => a + b, 0)
  if (total <= 0) return []
  const merged: Record<string, number> = {}
  for (const [id, n] of Object.entries(byModel)) merged[modelName(id)] = (merged[modelName(id)] ?? 0) + n
  return Object.entries(merged)
    .map(([name, n]) => ({ name, pct: Math.round((n / total) * 100) }))
    .sort((a, b) => b.pct - a.pct)
}

/** `2026-10-06` → `Tue`, read as a local calendar day. */
export function weekday(day: string): string {
  const [y, mo, d] = day.split('-').map(Number)
  if (!y || !mo || !d) return day
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, mo - 1, d).getDay()]!
}

/** Parses scan.py's stdout; null when it isn't the shape the card draws. */
export function parseScan(stdout: string): LocalStats | null {
  try {
    const v = JSON.parse(stdout) as LocalStats
    return v && typeof v.today?.tokens === 'number' && typeof v.week?.tokens === 'number' ? v : null
  } catch {
    return null
  }
}

/** `/usage-pane [open|close]`: no argument toggles. */
export function parseVerb(args: string): 'open' | 'close' | 'toggle' | null {
  const verb = args.trim().toLowerCase()
  if (verb === '') return 'toggle'
  if (verb === 'open' || verb === 'show') return 'open'
  if (verb === 'close' || verb === 'hide') return 'close'
  return null
}
