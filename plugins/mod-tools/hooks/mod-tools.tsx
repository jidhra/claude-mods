import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, On } from 'claude-code'

import type { ModToolsMod } from '../types'

const COMMAND = 'tools'
const FALLBACK_COMMAND = 'mod-tools'
const TITLE = '◆ M O D   T O O L S'
const FOOTER_LABEL = 'Mod Tools'
const RULE_LABEL = ' Mod Control Panel ─'
const LABEL_CELLS = 8
const MODS_HEADING = 'M O D S'

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

const isOpenAtom = atom({ plugin: 'mod-tools', key: 'isOpen' } as const, false)
const modelAtom = atom({ plugin: 'mod-tools', key: 'model' } as const, null)
const effortAtom = atom({ plugin: 'mod-tools', key: 'effort' } as const, null)
const modsAtom = atom({ plugin: 'mod-tools', key: 'mods' } as const, [])
const cleanViewAtom = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)

/** Each mod with a pane publishes whether it is open; the engine lists a plugin's panes only to that plugin. */
const flightdeckOpenAtom = atom({ plugin: 'flightdeck', key: 'paneOpen' } as const, false)
const pinboardOpenAtom = atom({ plugin: 'pinboard', key: 'paneOpen' } as const, false)
const bufferPaneOpenAtom = atom({ plugin: 'buffer-pane', key: 'paneOpen' } as const, false)
const usagePaneOpenAtom = atom({ plugin: 'usage-pane', key: 'paneOpen' } as const, false)

type PaneCommand = { command: string; args: string }

/** The mods that have a pane: where Show reads whether it is open, and the commands that show and hide it. */
export const PANES: Readonly<Record<string, { show: PaneCommand; hide: PaneCommand }>> = {
  flightdeck: { show: { command: 'flightdeck', args: 'open' }, hide: { command: 'flightdeck', args: 'close' } },
  pinboard: { show: { command: 'pinboard', args: '' }, hide: { command: 'pinboard', args: 'close' } },
  // /buffer-pane toggles
  'buffer-pane': { show: { command: 'buffer-pane', args: '' }, hide: { command: 'buffer-pane', args: '' } },
  'usage-pane': { show: { command: 'usage-pane', args: 'open' }, hide: { command: 'usage-pane', args: 'close' } },
}

async function readPaneOpen($: Engine): Promise<Record<string, boolean>> {
  return {
    flightdeck: await read($, flightdeckOpenAtom),
    pinboard: await read($, pinboardOpenAtom),
    'buffer-pane': await read($, bufferPaneOpenAtom),
    'usage-pane': await read($, usagePaneOpenAtom),
  }
}

/** The bare plugin name: `pinboard@claude-mods` → `pinboard`. */
const baseName = (id: string) => id.split('@')[0] ?? id

async function setShown($: Engine, mod: ModToolsMod, isShown: boolean) {
  const pane = PANES[baseName(mod.id)]
  if (pane === undefined) {
    return
  }
  await $.command.run(isShown ? pane.show : pane.hide)
}

// Cells of the two switch columns, so every row's buttons line up under their headings
const SHOW_CELLS = 10
const ENABLED_CELLS = 8

/** Clean View stays loaded when switched off: its row runs /simple instead of disabling the plugin. */
export const CLEAN_VIEW_ID = 'clean-view@claude-mods'
const SELF_ID = 'mod-tools@claude-mods'

/** Short captions for the mods this panel knows; any other mod shows its name alone. */
const CAPTIONS: Readonly<Record<string, string>> = {
  'clean-view': 'simple checklist',
  flightdeck: 'agent dashboard',
  'buffer-pane': 'text snippets pane',
  pinboard: 'decisions, tasks & links pane',
  'usage-pane': 'plan limits & session usage pane',
  'secret-redactor': 'hides secrets & PII',
}

/** `clean-view@claude-mods` → `Clean View`. */
export function modName(id: string): string {
  return (id.split('@')[0] ?? id)
    .split(/[-_]/)
    .filter(word => word !== '')
    .map(word => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

type ListedPlugin = { id: string; enabled: boolean; installPath: string }

/** A mod is a plugin whose hooks/hooks.json loads function-hook modules; classic-hook plugins (Codex) are not. */
async function isMod($: Engine, installPath: string): Promise<boolean> {
  try {
    const manifest = asRecord(JSON.parse(String(await $.fs.read(`${installPath}/hooks/hooks.json`))))

    return Array.isArray(manifest.modules) && manifest.modules.length > 0
  } catch {
    return false
  }
}

/** Lists the installed mods (not this one) from `claude plugin list --json`. */
async function refreshMods($: Engine) {
  let listed: ListedPlugin[]
  try {
    const { exitCode, stdout } = await $.process.run(['claude', 'plugin', 'list', '--json'])
    if (exitCode !== 0) {
      return
    }
    listed = JSON.parse(stdout) as ListedPlugin[]
  } catch {
    return
  }

  const mods: ModToolsMod[] = []
  for (const plugin of listed) {
    if (plugin.id !== SELF_ID && (await isMod($, plugin.installPath))) {
      mods.push({ id: plugin.id, name: modName(plugin.id), enabled: plugin.enabled })
    }
  }
  mods.sort((a, b) => a.name.localeCompare(b.name))
  await update($, modsAtom, () => mods)
}

/** Enables or disables each plugin, then reloads once. Returns false if a switch failed (its error is toasted). */
async function switchPlugins($: Engine, ids: readonly string[], isOn: boolean): Promise<boolean> {
  let isOk = true
  for (const id of ids) {
    const { exitCode, stderr, stdout } = await $.process.run(['claude', 'plugin', isOn ? 'enable' : 'disable', id, '--scope', 'user'])
    if (exitCode !== 0) {
      isOk = false
      $.ui.toast(`${modName(id)}: ${(stderr || stdout).trim().split('\n')[0] ?? 'could not switch'}`)
    }
  }
  if (ids.length > 0) {
    await refreshMods($)
    await $.command.run({ command: 'reload-plugins', args: '' })
  }

  return isOk
}

async function setMod($: Engine, mod: ModToolsMod, isOn: boolean) {
  if (mod.id === CLEAN_VIEW_ID && mod.enabled) {
    await setCleanView($, isOn)
    return
  }
  if (await switchPlugins($, [mod.id], isOn)) {
    $.ui.toast(`${mod.name}: ${isOn ? 'On' : 'Off'}`)
  }
}

async function setAllMods($: Engine, isOn: boolean) {
  const mods = await read($, modsAtom)
  const cleanView = mods.find(mod => mod.id === CLEAN_VIEW_ID)
  // Clean View switches by /simple; it is only enabled as a plugin when All on finds it disabled.
  const ids = mods
    .filter(mod => mod.enabled !== isOn && (mod.id !== CLEAN_VIEW_ID || isOn))
    .map(mod => mod.id)
  if (cleanView?.enabled && !isOn) {
    await setCleanView($, false)
  }
  await switchPlugins($, ids, isOn)
  if (cleanView !== undefined && isOn) {
    await setCleanView($, true)
  }
  $.ui.toast(isOn ? 'All mods on' : 'All mods off')
}

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

async function setOpen($: Engine, isOpen: boolean) {
  await update($, isOpenAtom, () => isOpen)
  if (isOpen) {
    await refresh($)
    await refreshMods($)
  }
}

async function toggleFromCommand($: Engine) {
  const isOpen = !(await read($, isOpenAtom))
  await setOpen($, isOpen)

  return isOpen ? 'Mod Tools is open above the prompt.' : 'Mod Tools is closed.'
}

export function registerModTools(on: On) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Open or close Mod Tools' })
    } catch {
      await $.command.register({ name: FALLBACK_COMMAND, description: 'Open or close Mod Tools' })
    }

    await refresh($)
    await refreshMods($)

    return next(e)
  })

  on('command.run', { command: 'tools' }, async $ => ({ text: await toggleFromCommand($) }))
  on('command.run', { command: 'mod-tools' }, async $ => ({ text: await toggleFromCommand($) }))

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
    const isCleanViewOn = await read($, cleanViewAtom)
    const mods = await read($, modsAtom)
    const paneOpen = await readPaneOpen($)
    // A mod reads On when its plugin is enabled; Clean View also needs /simple on.
    const isOn = (mod: ModToolsMod) => mod.enabled && (mod.id !== CLEAN_VIEW_ID || isCleanViewOn)
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

    const modRow = (mod: ModToolsMod) => {
      const isModOn = isOn(mod)
      const caption = CAPTIONS[baseName(mod.id)]
      const hasPane = mod.enabled && PANES[baseName(mod.id)] !== undefined
      const isShown = paneOpen[baseName(mod.id)] === true

      return (
        <Box key={`row:${mod.id}`} flexDirection="row" justifyContent="space-between" gap={2}>
          <Box flexDirection="row" gap={1} flexShrink={1}>
            <Text color={isModOn ? 'success' : 'inactive'}>{isModOn ? '●' : '○'}</Text>
            <Text bold>{mod.name}</Text>
            {caption !== undefined && (
              <Text dimColor wrap="truncate-end">
                {caption}
              </Text>
            )}
          </Box>
          <Box flexDirection="row" flexShrink={0}>
            <Box width={SHOW_CELLS} flexShrink={0}>
              {hasPane &&
                (isShown ? (
                  <Box backgroundColor="success">
                    <Button key={`show:${mod.id}`} plain label=" ● Shown " onPress={() => setShown($, mod, false)} />
                  </Box>
                ) : (
                  <Button key={`show:${mod.id}`} plain label=" ○ Hidden " onPress={() => setShown($, mod, true)} />
                ))}
            </Box>
            <Box width={ENABLED_CELLS} flexShrink={0}>
              {isModOn ? (
                <Box backgroundColor="success">
                  <Button key={`mod:${mod.id}`} plain label=" ● On " onPress={() => setMod($, mod, false)} />
                </Box>
              ) : (
                <Button key={`mod:${mod.id}`} plain label=" ○ Off " onPress={() => setMod($, mod, true)} />
              )}
            </Box>
          </Box>
        </Box>
      )
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

          <Box key="heading:mods" flexDirection="row" justifyContent="space-between" gap={2} marginTop={1} marginBottom={1}>
            <Box flexDirection="row" gap={2} paddingLeft={2} flexShrink={1}>
              <Text dimColor>{MODS_HEADING}</Text>
              {mods.length > 0 && (
                <Box flexDirection="row" gap={1}>
                  <Button key="mods:allOn" plain label=" All on " onPress={() => setAllMods($, true)} />
                  <Button key="mods:allOff" plain label=" All off " onPress={() => setAllMods($, false)} />
                </Box>
              )}
            </Box>
            {mods.length > 0 && (
              <Box flexDirection="row" flexShrink={0}>
                <Box width={SHOW_CELLS} flexShrink={0}>
                  <Text dimColor> Show</Text>
                </Box>
                <Box width={ENABLED_CELLS} flexShrink={0}>
                  <Text dimColor> Enabled</Text>
                </Box>
              </Box>
            )}
          </Box>
          {mods.length > 0 ? mods.map(modRow) : <Text dimColor>No other mods installed</Text>}
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
