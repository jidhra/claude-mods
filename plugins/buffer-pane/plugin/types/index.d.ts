/** Whether the Buffer pane is open; Mod Tools reads it for its Show column. */
export type PaneOpen = boolean

declare module 'claude-code' {
  interface PluginState {
    'buffer-pane': {
      paneOpen: PaneOpen
    }
  }
}
