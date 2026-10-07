import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

const STORE_KEY = 'cleanViewEnabled'
const TOGGLE_KEY = 'toggle'

const enabledAtom = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)

type Engine = EngineInterface

async function setEnabled($: Engine, isOn: boolean) {
  await update($, enabledAtom, () => isOn)
  try {
    await $.store.set(STORE_KEY, isOn)
  } catch {
    // Remembering is best effort; the session still has the setting.
  }
  $.ui.toast(isOn ? 'Clean View is on: technical details are hidden' : 'Clean View is off: showing everything')
}

/** Draws a technical transcript row as nothing while Clean View is on. */
async function hideRow($: Engine, e: RenderInput, drawAsUsual: () => Promise<RenderElement>): Promise<RenderElement> {
  if (!(await read($, enabledAtom))) {
    return drawAsUsual()
  }
  const { Box } = $.ui.resolve(e)

  return <Box display="none" />
}

export function registerCleanView(on: On) {
  on('session.start', async ($, e, next) => {
    try {
      const stored = await $.store.get(STORE_KEY)
      await update($, enabledAtom, () => stored !== false)
    } catch {
      // Starts on when nothing was remembered.
    }

    await $.command.register({
      name: 'simple',
      description: 'Turn Clean View on or off (no argument flips it)',
      argumentHint: 'on|off',
    })

    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Use /simple on, /simple off, or just /simple to flip it.' }
    }

    const isOn = arg === '' ? !(await read($, enabledAtom)) : arg === 'on'
    await setEnabled($, isOn)

    return { text: isOn ? 'Clean View is on.' : 'Clean View is off.' }
  })

  on('ui.render', { component: 'ToolUse' }, ($, e, next) => hideRow($, e, () => next(e)))
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => hideRow($, e, () => next(e)))
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => hideRow($, e, () => next(e)))

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabledAtom)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)
    const above = await next(e)

    return (
      <Box flexDirection="column">
        {above}
        {await drawToggle($, e)}
      </Box>
    )
  })
}

/** Draws the on/off button at the right edge; another plugin's band, if any, stacks above it. */
async function drawToggle($: Engine, e: RenderInput<'AbovePrompt'>): Promise<RenderElement> {
  const { Box, Button } = $.ui.resolve(e)
  const isOn = await read($, enabledAtom)
  const columns = Math.max(24, e.props.bodyColumns)

  return (
    <Box flexDirection="row" justifyContent="flex-end" width={columns}>
      <Button
        key={TOGGLE_KEY}
        label={isOn ? '● Clean View: ON' : '○ Clean View: OFF'}
        variant={isOn ? 'primary' : 'secondary'}
        onPress={() => setEnabled($, !isOn)}
      />
    </Box>
  )
}
