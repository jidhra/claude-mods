import type { Register } from 'claude-code'

import { registerModTools } from './mod-tools'

export const register: Register = on => {
  registerModTools(on)
}
