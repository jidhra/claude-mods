export type Todo = { text: string; isDone: boolean }

export type Pin = { href: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    pinboard: {
      asks: string[]
      todos: Todo[]
      links: Pin[]
    }
  }
}
