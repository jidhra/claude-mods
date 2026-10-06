import type { Register } from 'claude-code'

import { registerJidhrasTools } from './jidhras-tools'

export const register: Register = on => {
  registerJidhrasTools(on)
}
