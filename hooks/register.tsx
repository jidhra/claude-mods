import type { Register } from 'claude-code'

import { registerCleanView } from './clean-view'
import { registerAgentDock } from './dock'

export const register: Register = on => {
  // The dock goes first so its hook on helpers' report_progress answers before Clean View's.
  registerAgentDock(on)
  registerCleanView(on)
}
