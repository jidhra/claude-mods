# 0004. The store holds one text for each working directory

- Status: accepted
- Date: 2026-09-17

## Context

`$.store` is a JSON store for each plugin, kept between sessions and hot reloads. The buffer
holds requests for the agent of one repository, so another repository needs another list.

The render hook fires many times a second.

## Decision

- The key is `buffer:<cwd>`, with the working directory that `$.session.cwd()` returns. The
  module reads the key at `session.start` and again when the pane opens, because the working
  directory can change during a session. It skips the read when the key is already loaded:
  state is newer than the store while a write is in flight.
- The value is `{ text, sent, draft }`. `text` is the buffer as one text with a blank line
  between blocks (see 0001). `sent` is the list from 0002. `draft` is the text in the last
  field before Enter, kept so that a hot reload does not lose a half-written line.
- The module checks each field of a value that it reads. A value of another shape reads as an
  empty buffer, so the pane still opens.
- Writes happen on input events only: `onInput`, `onSubmit`, and a press of `[+]` or `[x]`.
  Each one changes state, writes the store, then asks for a redraw. The render hook draws from
  state.

## Consequences

- The multi-line editor of Milestone 2 edits the same `text`, so the store format stays.
- Two sessions in one directory share a key, and the last write wins. A session does not see
  the other session's write until it starts again.
- A buffer for all repositories is a possible later key (`buffer:*`). It does not exist now.
