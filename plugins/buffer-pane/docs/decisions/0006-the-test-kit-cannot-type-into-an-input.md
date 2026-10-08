# 0006. The test kit cannot type into an Input

- Status: accepted
- Date: 2026-09-17

## Context

Measured with Claude Code 2.1.274. The `$.ui` of `claude plugin test` has `render`, `scroll`,
`focus` and `press`. A press on the key of an `Input` is refused with "no Button ... is drawn".
In a dump of a drawn tree, each `Input` node held `props` (key, value, labels) and a numeric
`press.handle`; the type declarations say that the engine keeps the `onInput` and `onSubmit`
closures under that handle. A test thus has no function to call and no event to raise.

## Decision

Each `Input` closure is one line that calls a pure function and then `commit`:
`afterSubmitOf`, `afterDraftOf`, `afterEditOf`, `afterEditSubmitOf`. The tests call these
functions, `storedOf` and `storeKeyOf` directly. The tests press `[+]` and `[x]` through the
engine, and those presses go through the same `commit`, so the path from a change to
`store.set` has an end-to-end test.

## Consequences

- The wiring from an `Input` closure to its pure function has no automatic test. A
  real-terminal check covers it.
- When the kit gets a call for `ui.input`, add end-to-end tests for Enter and for typing.
