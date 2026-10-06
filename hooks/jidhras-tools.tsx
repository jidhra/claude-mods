import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, On } from 'claude-code'

const COMMAND = 'tools'
const FALLBACK_COMMAND = 'jidhras-tools'
const TITLE = "◆ J I D H R A ' S   T O O L S"
const FOOTER_LABEL = "Jidhra's Tools"
const RULE_LABEL = " Jidhra's Control Panel ─"
const LABEL_CELLS = 8

type Engine = EngineInterface

type ModelChoice = {
  id: string
  label: string
  family: string
  hasEffort: boolean
}

type EffortChoice = {
  value: string
  label: string
}

/** The models the panel offers, in the order drawn. Opus keeps the 1M context window. */
export const MODELS: readonly ModelChoice[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'haiku', hasEffort: false },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', family: 'sonnet', hasEffort: true },
  { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5', family: 'opus', hasEffort: true },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', family: 'fable', hasEffort: true },
]

export const EFFORTS: readonly EffortChoice[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
]

const isOpenAtom = atom({ plugin: 'jidhras-tools', key: 'isOpen' } as const, false)
const modelAtom = atom({ plugin: 'jidhras-tools', key: 'model' } as const, null)
const effortAtom = atom({ plugin: 'jidhras-tools', key: 'effort' } as const, null)
const hasCleanViewAtom = atom({ plugin: 'jidhras-tools', key: 'hasCleanView' } as const, false)
const hasAgentDockAtom = atom({ plugin: 'jidhras-tools', key: 'hasAgentDock' } as const, false)
const cleanViewAtom = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)

/** Finds which offered model a model name (an id, an alias, a /config value) is. */
export function modelFor(name: string | null): ModelChoice | null {
  if (name === null) {
    return null
  }
  const lower = name.toLowerCase()

  return MODELS.find(model => lower.includes(model.family)) ?? null
}

export function effortFor(name: string | null): EffortChoice | null {
  if (name === null) {
    return null
  }
  const lower = name.toLowerCase()

  return EFFORTS.find(effort => effort.value === lower) ?? null
}

function findRow(rows: readonly ConfigRow[], name: 'model' | 'effort'): ConfigRow | undefined {
  const matches = (text: string) => (name === 'model' ? /^model$/i.test(text) : /effort/i.test(text))

  return rows.find(row => row.provider.plugin === 'engine' && (matches(row.key) || matches(row.label)))
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** The effort settings hold for a model: its own `modelSettings` entry, else the global `effortLevel`. */
function savedEffort(settings: Record<string, unknown>, model: string | null): string | null {
  const choice = modelFor(model)
  if (choice !== null) {
    const perModel = asRecord(settings.modelSettings)
    const bareId = choice.id.replace('[1m]', '')
    const key = bareId in perModel ? bareId : Object.keys(perModel).find(name => modelFor(name)?.family === choice.family)
    const effort = key === undefined ? null : asText(asRecord(perModel[key]).effortLevel)
    if (effort !== null) {
      return effort
    }
  }

  return asText(settings.effortLevel)
}

async function readSettings($: Engine): Promise<Record<string, unknown>> {
  try {
    return asRecord(await $.settings.read())
  } catch {
    return {}
  }
}

/** Reads the session's model from `/config` (or settings) and its effort from `/config` or settings. */
async function refresh($: Engine) {
  let model: string | null = null
  let effort: string | null = null
  try {
    const rows = await $.config.list()
    model = asText(findRow(rows, 'model')?.value)
    effort = asText(findRow(rows, 'effort')?.value)
  } catch {
    // The settings below are the fallback.
  }

  const settings = await readSettings($)
  model ??= asText(settings.model)
  effort ??= savedEffort(settings, model)

  if (model !== null) {
    await update($, modelAtom, () => model)
  }
  if (effort !== null) {
    await update($, effortAtom, () => effort)
  }
}

async function chooseModel($: Engine, model: ModelChoice) {
  await update($, modelAtom, () => model.id)
  await $.command.run({ command: 'model', args: model.id })
  const effort = savedEffort(await readSettings($), model.id)
  if (effort !== null) {
    await update($, effortAtom, () => effort)
  }
  $.ui.toast(`Model: ${model.label}`)
}

/** Sets effort through its `/config` row where this build has one, else `/effort`. */
async function chooseEffort($: Engine, effort: EffortChoice) {
  await update($, effortAtom, () => effort.value)
  const row = findRow(await $.config.list(), 'effort')
  const fits = row !== undefined && !row.isLocked && (row.kind === 'text' || (row.options ?? []).includes(effort.value))
  const answer = fits ? await $.config.set({ key: row.key, value: effort.value }).catch(() => undefined) : undefined
  if (answer === undefined || answer.deny !== undefined) {
    await $.command.run({ command: 'effort', args: effort.value })
  }
  $.ui.toast(`Effort: ${effort.label}`)
}

async function setCleanView($: Engine, isOn: boolean) {
  await $.command.run({ command: 'simple', args: isOn ? 'on' : 'off' })
}

async function openAgentDock($: Engine) {
  await $.command.run({ command: 'dock', args: '' })
}

async function setOpen($: Engine, isOpen: boolean) {
  await update($, isOpenAtom, () => isOpen)
  if (isOpen) {
    await refresh($)
  }
}

async function toggleFromCommand($: Engine) {
  const isOpen = !(await read($, isOpenAtom))
  await setOpen($, isOpen)

  return isOpen ? "Jidhra's Tools is open above the prompt." : "Jidhra's Tools is closed."
}

export function registerJidhrasTools(on: On) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: "Open or close Jidhra's Tools" })
    } catch {
      await $.command.register({ name: FALLBACK_COMMAND, description: "Open or close Jidhra's Tools" })
    }

    try {
      const commands = await $.command.list()
      await update($, hasCleanViewAtom, () => commands.some(command => command.name === 'simple'))
      await update($, hasAgentDockAtom, () => commands.some(command => command.name === 'dock'))
    } catch {
      // Without the list, the Clean View and Agent Dock rows say they are not installed.
    }
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'tools' }, async $ => ({ text: await toggleFromCommand($) }))
  on('command.run', { command: 'jidhras-tools' }, async $ => ({ text: await toggleFromCommand($) }))

  on('turn.start', async ($, e, next) => {
    if (await read($, isOpenAtom)) {
      await refresh($)
    }

    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const isOpen = await read($, isOpenAtom)

    return (
      <Box flexDirection="row" gap={2}>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        <Button
          key="open"
          plain
          label={`◆ ${FOOTER_LABEL} ${isOpen ? '▴' : '▾'}`}
          onPress={() => setOpen($, !isOpen)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOpenAtom))) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    const width = Math.max(32, e.props.bodyColumns)
    const model = modelFor(await read($, modelAtom))
    const effort = effortFor(await read($, effortAtom))
    const hasEffort = model === null || model.hasEffort
    const hasCleanView = await read($, hasCleanViewAtom)
    const isCleanViewOn = hasCleanView && (await read($, cleanViewAtom))
    const hasAgentDock = await read($, hasAgentDockAtom)

    // LAUNCH and SETTINGS share one look: dim, letter-spaced, a blank line above and below.
    const sectionHeading = (label: string) => (
      <Box key={`heading:${label}`} marginTop={1} marginBottom={1} paddingLeft={2}>
        <Text dimColor>{label}</Text>
      </Box>
    )

    const summary = [model?.label ?? 'Default model', hasEffort ? (effort?.label ?? 'Default effort') : null]
      .filter(part => part !== null)
      .join(' · ')

    const modelRow = MODELS.map(choice =>
      choice.family === model?.family ? (
        <Text backgroundColor="claude" color="inverseText" bold>
          {` ${choice.label} `}
        </Text>
      ) : (
        <Button key={`model:${choice.family}`} plain label={` ${choice.label} `} onPress={() => chooseModel($, choice)} />
      ),
    )

    const effortRow = hasEffort ? (
      EFFORTS.map(choice =>
        choice.value === effort?.value ? (
          <Text backgroundColor="permission" color="inverseText" bold>
            {` ${choice.label} `}
          </Text>
        ) : (
          <Button key={`effort:${choice.value}`} plain label={` ${choice.label} `} onPress={() => chooseEffort($, choice)} />
        ),
      )
    ) : (
      <Text dimColor> {model?.label} doesn't use an effort setting</Text>
    )

    let cleanViewControl
    if (!hasCleanView) {
      cleanViewControl = <Text dimColor>not installed</Text>
    } else if (isCleanViewOn) {
      cleanViewControl = (
        <Box backgroundColor="success">
          <Button key="cleanView" plain label=" ● On " onPress={() => setCleanView($, false)} />
        </Box>
      )
    } else {
      cleanViewControl = <Button key="cleanView" plain label=" ○ Off " onPress={() => setCleanView($, true)} />
    }

    const panel = (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Text color="claude" bold wrap="truncate-end">
              {TITLE}
            </Text>
            <Text wrap="truncate-end">{summary}</Text>
          </Box>

          <Box flexDirection="row" marginTop={1}>
            <Box width={LABEL_CELLS} flexShrink={0}>
              <Text dimColor>MODEL</Text>
            </Box>
            <Box flexDirection="row" flexWrap="wrap" flexShrink={1}>
              {modelRow}
            </Box>
          </Box>
          <Box flexDirection="row">
            <Box width={LABEL_CELLS} flexShrink={0}>
              <Text dimColor>EFFORT</Text>
            </Box>
            <Box flexDirection="row" flexWrap="wrap" flexShrink={1}>
              {effortRow}
            </Box>
          </Box>

          {sectionHeading('L A U N C H')}
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Box flexDirection="row" gap={1} flexShrink={1}>
              <Text color="claude">◆</Text>
              <Text bold>Agent Dock</Text>
              <Text dimColor wrap="truncate-end">
                split requests across helpers
              </Text>
            </Box>
            {hasAgentDock ? (
              <Button key="agentDock" plain label=" Open " onPress={() => openAgentDock($)} />
            ) : (
              <Text dimColor>not installed</Text>
            )}
          </Box>

          {sectionHeading('S E T T I N G S')}
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Box flexDirection="row" gap={1} flexShrink={1}>
              <Text color={isCleanViewOn ? 'success' : 'inactive'}>{isCleanViewOn ? '●' : '○'}</Text>
              <Text bold>Clean View</Text>
              <Text dimColor wrap="truncate-end">
                simple checklist
              </Text>
            </Box>
            {cleanViewControl}
          </Box>
        </Box>
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(Math.max(0, width - RULE_LABEL.length))}
          {RULE_LABEL}
        </Text>
      </Box>
    )

    // No size props on this wrapper: the engine refuses its own band node under a sized Box.
    return (
      <Box flexDirection="column">
        {panel}
        {below}
      </Box>
    )
  })
}
