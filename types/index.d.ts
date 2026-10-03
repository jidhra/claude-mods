export type Todo = { id: string; text: string; isDone: boolean; isActive?: boolean }

export type Decision = { id: string; text: string }

export type Pin = { href: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    pinboard: {
      decisions: Decision[]
      todos: Todo[]
      links: Pin[]
    }
  }
}
