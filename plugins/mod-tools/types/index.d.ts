export type ModToolsModel = string | null

export type ModToolsEffort = string | null

/** An installed mod the panel can switch: its plugin id, display name and whether the plugin is enabled. */
export type ModToolsMod = { id: string; name: string; enabled: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mod-tools': {
      isOpen: boolean
      model: ModToolsModel
      effort: ModToolsEffort
      mods: ModToolsMod[]
    }
  }
}
