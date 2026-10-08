# 0003. One-line fields first, then a multi-line editor

- Status: accepted
- Date: 2026-09-17

## Context

The type declarations call `Input` "every surface's one-line text field": Enter raises
`onSubmit`. The way to a multi-line editor is a `Client` surface module that reads keys through
`surface.onKey`. pull-request-pane uses `Client` for pointer input only, so the key path is new
ground, and a real terminal must show how it behaves, for example with an input method for
Japanese.

## Decision

Milestone 1 draws each block as one `Input` with `[+]` and `[x]` at its left. A last `Input`
adds a block on Enter. One block is one line in this milestone. The path "write, keep, send"
works end to end before the editor exists.

Milestone 2 replaces the fields with a `Client` editor in which a block can have more than one
line. Its logic is a pure function `(state, key) => state`, with tests that use CJK text,
because a CJK character is two cells wide and cursor math by `string.length` is wrong for it.
The first task of Milestone 2 is a real-terminal check of how composed input reaches `onKey`.

Details of Milestone 1 that come from the `Input` contract:

- A block has a numeric id, and the id is in the element key. When `[x]` deletes a block, the
  fields below it keep their keys, so the surface does not move typed text between blocks.
- The key of the last field changes on each Enter. The surface keeps the typed text of an
  element it knows, and an empty `value` for the same key might not clear the field.
- `onInput` stores each change in state, so each redraw draws the same text that the person
  typed.
- Enter in the field of a block that the person emptied deletes the block.

## Consequences

- Milestone 1 cannot hold a multi-line block. The store format already can (see 0004).
- v0 has no undo, selection, copy or search.
