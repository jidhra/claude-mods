export type CleanViewPhase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type CleanViewTaskStatus = 'done' | 'active' | 'upcoming'

export type CleanViewTask = {
  id: string
  name: string
  status: CleanViewTaskStatus
  percent: number
  hasReported: boolean
}

export type CleanViewChecklist = {
  title: string
  phase: CleanViewPhase
  tasks: CleanViewTask[]
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  isCollapsed: boolean
}

export type DockHelperStatus = 'queued' | 'working' | 'done' | 'stuck'

export type DockHelper = {
  id: string
  name: string
  status: DockHelperStatus
  percent: number
  hasReported: boolean
  startedAt: number | null
  finishedAt: number | null
  agentId: string | null
}

export type DockMission = {
  job: string
  startedAt: number
  helpers: DockHelper[]
  agentCalls: number
  isNudged: boolean
  isStopped: boolean
}

export type DockCounts = { working: number; queued: number; done: number; stuck: number }

export type DockHelperModel = 'fast' | 'same' | 'stepDown'

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      cleanViewEnabled: boolean
      checklist: CleanViewChecklist | null
      tick: number
      dockSize: number
      dockHelperModel: DockHelperModel
      dockMission: DockMission | null
      dockTick: number
      dockSessionModel: string | null
      dockSessionEffort: string | null
    }
  }
}
