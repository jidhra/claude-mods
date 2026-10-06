export type JidhrasToolsModel = string | null

export type JidhrasToolsEffort = string | null

declare module 'claude-code' {
  interface PluginState {
    'jidhras-tools': {
      isOpen: boolean
      model: JidhrasToolsModel
      effort: JidhrasToolsEffort
      hasCleanView: boolean
    }
  }
}
