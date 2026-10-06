# Clean View

A Claude Code mod that makes Claude Code calm and friendly for people who aren't technical. While Claude works, tool calls, file diffs and command output are hidden. A simple checklist above the prompt shows the plan, what's happening now and how far along it is.

```
Build my landing page · 1m 12s                     [ ● Clean View: ON ]
✓ Read your brand notes            ██████████  Done
▶ Build the pricing section        ██████░░░░  60%
○ Add the contact form             ░░░░░░░░░░  Next
○ Polish the footer                ░░░░░░░░░░  Up next
```

## Install

In a Claude Code terminal session, type:

```
/plugin install clean-view --marketplace jidhra/clean-view
```

Answer `y` to add the marketplace, then press Enter to choose the user scope. The repository is private, so you need access to it on GitHub.

## Turn it on and off

- Clean View starts on.
- Click the **Clean View** button at the right of the checklist, or type `/simple off`, `/simple on`, or `/simple` to flip it.
- Your choice is remembered after a restart.
- When it's off, every hidden row comes back and Claude no longer has to plan first.

## What it does

- Claude lays out a plan with `plan_steps` before using other tools, and reports progress with `report_progress`.
- To-do lists (TodoWrite, TaskCreate, TaskUpdate) also fill the checklist.
- The header shows **Needs you** when Claude is waiting on a permission or a question, **Stuck** when something keeps failing, **Stopped** after Esc, and **All done** when finished.

## Agent Dock

Agent Dock ships in this plugin. Pick a **Team Size** from 1 to 10, and each request you send is split across exactly that many helper agents running in parallel. A pane shows each helper as a card with a badge, its task, a timer and a meter. When they all finish, Claude combines their work and the dock shows a summary like "7 agents finished Research bakery pricing in 2m 14s".

```
◆  A G E N T   D O C K                                           ● L I V E
────────────────────────────────────────────────────────────────────────────
T E A M  S I Z E   ‹  1  2  3  4  5 [ 6 ] 7  8  9  10  ›
Splits each request across 6 helpers  ·  all run at once
H E L P E R S     Fast & Cheap [ Same as me ] One step down
Helpers run on Opus 5.5 · high effort
```

- `/dock` opens the pane, or folds it to a status-bar badge like "3 working · 1 queued · 2 done".
- `/dock 6` sets the Team Size. Click a number in the pane, press ‹ or ›, or press 1–9 (0 for 10) while the pane has focus. At size 1, Claude decides how many helpers to use.
- `/dock helpers fast|same|stepdown` picks the helpers' model: Haiku 4.5, your model, or one model down (Fable → Opus → Sonnet → Haiku). Helpers keep your effort level, since the Agent tool takes a model per helper but no effort.
- Jidhra's Tools (`/tools`) has a Launch row that opens the dock and a Helpers toggle under Settings.
- The live helper count is written to `~/.claude/ai-employee-kit-data/agents-now/<session>.json` for the status line.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
