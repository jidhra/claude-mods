# Jidhra's Tools

A Claude Code mod that puts a **◆ Jidhra's Tools ▾** button at the bottom right of the prompt footer. Click it to open a small control panel above the prompt:

```
╭──────────────────────────────────────────────────────────────╮
│ ◆ J I D H R A ' S   T O O L S                Opus 5.5 · High │
│                                                              │
│ MODEL   Haiku 4.5  Sonnet 5.5 [Opus 5.5] Fable 5.1           │
│ EFFORT  Low  Medium [High] XHigh  Max                        │
│                                                              │
│   L A U N C H                                                │
│                                                              │
│ ◆ Agent Dock  split requests across helpers           Open   │
│                                                              │
│   S E T T I N G S                                            │
│                                                              │
│ ● Clean View  simple checklist                        ● On   │
╰──────────────────────────────────────────────────────────────╯
──────────────────────────────────────── Jidhra's Control Panel ─
```

- **Model**: click a model to switch to it (runs `/model` with its full ID; Opus keeps the 1M context window).
- **Effort**: click a level to set it (runs `/effort`). Haiku doesn't use effort, so the row says so.
- **Agent Dock** (under Launch): opens the Agent Dock pane (runs `/dock`). If Agent Dock isn't installed, the row says so.
- **Clean View**: turns the [Clean View](https://github.com/jidhra/clean-view) mod on or off (runs `/simple on|off`). If Clean View isn't installed, the row says so.

Colors come from your Claude Code theme, so the panel follows whatever theme you've picked in `/config`.

If you can't click the footer, type `/tools` to open or close the panel.

## Install

Clean View first, since this panel controls it:

```
claude plugin marketplace add jidhra/clean-view
claude plugin install clean-view@clean-view --scope user
claude plugin marketplace add jidhra/jidhras-tools
claude plugin install jidhras-tools@jidhras-tools --scope user
```

Or, inside Claude Code: `/plugin install jidhras-tools --marketplace jidhra/jidhras-tools`.

Both repositories are private, so you need access to them on GitHub.

## Develop

```
claude plugin validate .
claude plugin test .
```
