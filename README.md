# Pinboard

A Claude Code mod that keeps the things you need to act on in a sidebar pane, so they don't scroll out of view in the transcript.

## What it pins

- **Waiting on you**: the questions in Claude's latest reply (prose lines ending in `?`, outside code blocks, quotes and tables). Each reply replaces the last reply's questions.
- **Todos**: Markdown checkbox items (`- [ ] item`, `- [x] item`) from Claude's replies. Each reply that holds checkboxes replaces the whole list, so reworded or dropped items don't linger.
- **Links**: URLs from any tool result that holds one to three of them, newest first, up to 12. GitHub PRs and issues get short labels such as `repo PR #12`. Press `l` (or the **clear** button) to empty the list.

Everything is session state: `/clear` and `/resume` start an empty board.

## How it opens

- The pane opens by itself the first time something lands on an empty board.
- Opened that way, Claude Code only seats it in a terminal at least 144 columns wide (110 once you've opened it yourself). Below that, run `/pinboard`.
- `/pinboard` opens it at any width, even while Claude is working. Ctrl+X then X closes it.

## What it adds to the system prompt

Pinboard doesn't depend on the `TodoWrite` or Task tools, which newer models don't get by default. It adds one line to the system prompt so todo lists come out in a format it can read:

> When you lay out a task list for the work, write it as Markdown checkboxes (`- [ ] item` open, `- [x] item` done), one action per checkbox. Whenever any item changes, list the whole task list again, done items included.

## Install

```bash
claude plugin marketplace add <owner>/pinboard
claude plugin install pinboard@pinboard
```

## Develop

```bash
claude plugin validate --strict .
claude plugin test .
claude --plugin-dir .
```

Built on the mods API as of Claude Code 2.1.288. That API is in early access and changes between releases.
