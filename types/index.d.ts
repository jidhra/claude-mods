export type JidhrasToolsModel = string | null

export type JidhrasToolsEffort = string | null

/** An installed mod the panel can switch: its plugin id, display name and whether the plugin is enabled. */
export type JidhrasToolsMod = { id: string; name: string; enabled: boolean }

declare module 'claude-code' {
  interface PluginState {
    'jidhras-tools': {
      isOpen: boolean
      model: JidhrasToolsModel
      effort: JidhrasToolsEffort
      mods: JidhrasToolsMod[]
    }
  }
}
