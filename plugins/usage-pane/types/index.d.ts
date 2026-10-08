/** One rate-limit window as last measured: `five_hour`, `seven_day`, a model-scoped weekly. */
export type Limit = { kind: string; pct: number; resetsAt: string | null }

/**
 * Where a window stood when this session first saw it. `carried` is what the
 * session used of windows that have since reset, in percentage points.
 */
export type Baseline = { startPct: number; resetsAt: string | null; lastPct: number; carried: number }

/** This session's own totals. */
export type SessionTotals = {
  startedAt: number | null
  costUsd: number | null
  inTok: number
  outTok: number
  cacheRead: number
  cacheWrite: number
  turns: number
  prompts: number
  /** Output + input tokens by the model that answered. */
  byModel: Record<string, number>
  ctxPct: number | null
}

export type LocalDay = { tokens: number; prompts: number; sessions: number }

/** What hooks/scan.py prints: every session on this machine, today and over 7 days. */
export type LocalStats = {
  today: LocalDay
  week: LocalDay
  topModel: string | null
  busiestDay: string | null
  byDay: { day: string; tokens: number }[]
}

export type Local = { stats: LocalStats | null; scannedAt: number | null; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-pane': {
      limits: Limit[]
      baselines: Record<string, Baseline>
      session: SessionTotals
      local: Local
      /** Whether the Usage pane is open; Mod Tools reads it for its Show column. */
      paneOpen: boolean
      /** Bumped once a minute while the pane is open, so the reset countdowns redraw. */
      tick: number
    }
  }
}
