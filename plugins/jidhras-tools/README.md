# Jidhra's Tools

A Claude Code mod that puts a **◆ Jidhra's Tools ▾** button at the bottom right of the prompt footer. Click it to open a small control panel above the prompt:

```
╭──────────────────────────────────────────────────────────────╮
│ ◆ J I D H R A ' S   T O O L S                Opus 5.5 · High │
│                                                              │
│ MODEL   Haiku 4.5  Sonnet 5.5 [Opus 5.5] Fable 5.1           │
│ EFFORT  Low  Medium [High] XHigh  Max                        │
│                                                              │
│   M O D S                                  All on   All off  │
│                                                              │
│ ○ Buffer Pane  text snippets pane                     ○ Off  │
│ ● Clean View  simple checklist                        ● On   │
│ ● Flightdeck  agent dashboard                         ● On   │
│ ● Pinboard  decisions, tasks & links pane             ● On   │
│ ● Secret Redactor  hides secrets & PII                ● On   │
╰──────────────────────────────────────────────────────────────╯
──────────────────────────────────────── Jidhra's Control Panel ─
```

- **Model**: click a model to switch to it (runs `/model` with its full ID; Opus keeps the 1M context window).
- **Effort**: click a level to set it (runs `/effort`). Haiku doesn't use effort, so the row says so.
- **Mods**: every installed mod (a plugin whose `hooks/hooks.json` loads function-hook modules) gets an On/Off switch. Plugins that aren't mods, such as Codex, aren't listed, and neither is Jidhra's Tools itself.
  - Switching a mod runs `claude plugin enable|disable <id> --scope user`, then `/reload-plugins`.
  - Clean View is the exception: it stays loaded and its switch runs `/simple on|off`. If the Clean View plugin is disabled, its switch enables it.
  - **All on** / **All off** switch every listed mod at once, with a single reload.

Colors come from your Claude Code theme, so the panel follows whatever theme you've picked in `/config`.

If you can't click the footer, type `/tools` to open or close the panel.

## Install

```
claude plugin marketplace add jidhra/jidhras-tools
claude plugin install jidhras-tools@jidhras-tools --scope user
```

Or, inside Claude Code: `/plugin install jidhras-tools --marketplace jidhra/jidhras-tools`.

The repository is private, so you need access to it on GitHub.

## Develop

```
claude plugin validate .
claude plugin test .
```
