declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      cleanViewEnabled: boolean
    }
  }
}

export type CleanViewEnabled = boolean
