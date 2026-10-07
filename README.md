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

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
