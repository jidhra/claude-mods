# 0008. How keys reach a Client, measured in a real terminal

- Status: accepted
- Date: 2026-09-19

## Context

The multi-line editor of Milestone 2 (see 0003) reads keys through `surface.onKey` of a
`Client`. Before the editor existed, a throwaway plugin drew one `Client` that listed each key
event it received. The person typed into it in a real terminal, with a Japanese input method.

## What was measured

- ASCII arrives one character for each event: `a`, `b`, `c`.
- Text from the input method arrives after the person confirms it, in chunks of one or more
  code points: `日` in one event, then `本語` in the next. The chunks follow how the terminal
  writes bytes, not character boundaries. No event arrives while the text is unconfirmed.
- The Enter that confirms the input method's text is not delivered.
- A plain Enter arrives as `key: "return"`. Shift+Enter arrives as `return` with `shift`.
  Ctrl+Enter arrives as a plain `return`, so the two cannot be told apart. Ctrl+J arrives as
  `j` with `ctrl`.
- The arrow keys arrive by name (`left`).
- Tab moves the pane's focus ring (to the pane's close button); the Client does not see it.
- The unconfirmed text draws where the terminal's own cursor is, which is not inside the
  Client. `ClientSurface` has no call that places the terminal cursor, so this stays.
- `UiFocusArgs.key` names a `Button`, `Input` or `Select`. A `Client` gets the keys through a
  click only, and the hooks module cannot move the focus to one.

## Decision

- The editor inserts the whole `key` string when the key is not a named one, so a chunk of
  several code points goes in as one edit.
- `return` inserts a newline. The editor ignores `tab` and `ctrl` with `return`.
- Shift+Enter is kept free for a later keyboard action, as the one modifier that arrives.
- One `Client` holds the whole buffer, because the module cannot hand the focus to a second
  one. Blank lines split the text into blocks inside it.

## Consequences

- A person who types Japanese sees the unconfirmed text away from the editor's cursor.
- The gutter (`[+]`, `[>]`, `[x]`, the mark) must be drawn inside the Client, because only the
  Client knows which screen row a block starts on after wrapping. How a press reaches the
  module from inside a Client is the next measurement.

## Note, 2026-09-19, later

In every run after the one above, in the same terminal and with the same probe, the `Client`
received no key and no pointer event: the count stayed at 0, and each typed character went to
the prompt box. This held with `onKey` alone, with `onPointer` alone, and with both. The cause
was not found; the sessions wrote no debug log. So the `Client` editor and the drag to reorder
blocks are dropped. Blocks move with `[^]` and `[v]` Buttons, and the one-line blocks stay.
