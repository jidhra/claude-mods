# 0005. No hotkeys on Buttons

- Status: accepted
- Date: 2026-09-17

## Context

`Button` has a `hotkey` prop. In pull-request-pane, a hotkey on a Button in a pane did not fire
in two different terminal setups. The arrow keys move the focus between elements, Enter presses
the focused Button, and a click presses it too.

## Decision

No Button in this pane sets `hotkey`. The README promises no keyboard shortcut.

## Consequences

- Sending a block from the keyboard takes arrow keys and Enter.
- Test again when a Claude Code release changes the behavior of `hotkey` in a pane.
