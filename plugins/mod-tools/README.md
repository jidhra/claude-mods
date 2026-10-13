# Mod Tools

A Claude Code mod that puts a **◆ Mod Tools ▾** button at the bottom right of the prompt footer. Click it to open a small control panel above the prompt:

```
╭──────────────────────────────────────────────────────────────╮
│ ◆ M O D   T O O L S                          Opus 5.5 · High │
│                                                              │
│ MODEL   Haiku 4.5  Sonnet 5.5 [Opus 5.5] Fable 5.1           │
│ EFFORT  Low  Medium [High] XHigh  Max                        │
│                                                              │
│   M O D S   All on   All off                  Show  Enabled  │
│                                                              │
│ ○ Buffer Pane  text snippets pane                     ○ Off  │
│ ● Clean View  simple checklist                        ● On   │
│ ● Flightdeck  agent dashboard           [● Shown ]    ● On   │
│ ● Pinboard  decisions, tasks & links pa  ○ Hidden     ● On   │
│ ● Secret Redactor  hides secrets & PII                ● On   │
│ ● Usage Pane  plan limits & session us   ○ Hidden     ● On   │
╰──────────────────────────────────────────────────────────────╯
───────────────────────────────────────────── Mod Control Panel ─
```

- **Model**: click a model to switch to it (runs `/model` with its full ID; Opus keeps the 1M context window).
- **Effort**: click a level to set it (runs `/effort`). Haiku doesn't use effort, so the row says so.
- **Mods**: every installed mod (a plugin whose `hooks/hooks.json` loads function-hook modules) gets an On/Off switch. Plugins that aren't mods, such as Codex, aren't listed, and neither is Mod Tools itself.
  - Switching a mod runs `claude plugin enable|disable <id> --scope user`, then `/reload-plugins`.
  - Clean View is the exception: it stays loaded and its switch runs `/simple on|off`. If the Clean View plugin is disabled, its switch enables it.
  - **All on** / **All off** switch every listed mod at once, with a single reload.
- **Show**: mods that have a pane (Flightdeck, Pinboard, Buffer Pane, Usage Pane) get a Show/Hide button next to their On/Off switch. **● Shown** on a green background means the pane is open, and pressing it hides the pane. **○ Hidden**, with no background, means it's closed, and pressing it opens the pane. The button runs the mod's own command (`/flightdeck open|close`, `/pinboard`, `/pinboard close`, `/buffer-pane open|close`, `/usage-pane open|close`). A mod that's switched off, or that has no pane, leaves the cell empty.
  - The engine only lists a plugin's own panes, so each of those mods publishes a `paneOpen` value in its `$.state`, and Mod Tools reads it.

## Launch layout

When a session starts with a person at the prompt, Mod Tools opens the mod panes for you, in this tab order: **Flightdeck, Pinboard, Buffer pane, Usage**. Tabs sit in the order their panes opened, so Mod Tools runs the four show commands one at a time and waits for each before the next.

- A pane that's already open is left alone, and a mod that's switched off or not installed is skipped.
- It happens once per session. A plugin reload doesn't open them again (a `launched` flag in `$.state` survives the reload), and neither does `/clear`.
- None of them takes the keyboard, so you can type your first prompt straight away.
- Panes that open on their own only appear once the terminal is at least 144 columns wide (110 for a pane you've opened before). In a narrower terminal they wait until you widen it.

Colors come from your Claude Code theme, so the panel follows whatever theme you've picked in `/config`.

If you can't click the footer, type `/tools` to open or close the panel.

## Install

```
claude plugin marketplace add jidhra/claude-mods
claude plugin install mod-tools@claude-mods --scope user
```

Or, inside Claude Code: `/plugin install mod-tools --marketplace jidhra/claude-mods`.

## Develop

```
claude plugin validate .
claude plugin test .
```
