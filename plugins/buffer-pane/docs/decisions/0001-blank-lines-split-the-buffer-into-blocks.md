# 0001. Blank lines split the buffer into blocks

- Status: accepted
- Date: 2026-09-17

## Context

The pane holds the next things to tell the agent. One such thing is frequently more than one
line. A person also collects more than one of them while a long turn runs, and sends them one
at a time.

A `[+]` for each line cannot send a paragraph. One `[+]` for the whole buffer cannot send one
request and keep the others.

## Decision

The buffer is one text. One or more blank lines separate blocks. A line that holds only spaces
or tabs is a blank line, because a person cannot see the difference. Each block has one `[+]`
and one `[x]` in the gutter. One press of `[+]` sends one block.

## Consequences

- A block cannot contain a blank line. Text with a blank line becomes two blocks.
- The store holds the same one text (see 0004), so the block list is always derived from it.
