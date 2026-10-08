# AGENTS.md

Context for agents that work in this repository.

## What this is

buffer-pane, a Claude Code plugin whose behavior lives in one hooks module
(a "Claude Mod"). `/buffer-pane` opens a pane beside the transcript that
holds text the person writes for later: the next things to tell the agent.
The text is split into blocks. A `[+]` control in the gutter beside a block
writes that block into the prompt box. The buffer survives sessions.

The plugin lives in `plugin/`. There is no build step and no runtime package
dependency.

## Visibility

The repository is private today. The layer is public-possible: commit
messages, comments, README and docs are in English. Follow ASD-STE100
Simplified Technical English. Never commit a real buffer's content as a
fixture; tests use invented text.

## Rules

- Function hooks are early access. The module loads only where
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set. The API can change between
  releases. The types come from `/plugin-types`, which writes
  `.claude/types/claude-code.d.ts` at the repository root; that directory is
  gitignored, so run `/plugin-types` once in a new checkout.
- The validator reads the module statically. Hand `$` only to function
  declarations at the top of the module, and spell every call
  `$.noun.event(...)`. Build one `host` bundle of closures over `$` at
  `session.start`; the rest of the module holds the host, never `$`.
- Never write the store from the render hook. Write on input events, keep
  the result in state, and draw from state.
- Every `Pane` element prop must be one the surface declares. One unknown
  prop drops the whole tree without a message. Type the element constructors
  with `Elements['terminal']` so the compiler catches it.
- Tests are `plugin/tests/*.test.ts`, run with
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugin`. They stub
  `prompt.fill`, `ui.status` and `store.get`/`store.set`. A `Client` editor
  is tested as a plain function with a hand-rolled surface double.
- Quality gates: `claude plugin validate plugin`, `npx -p typescript tsc -p
  plugin/hooks`, and the plugin tests. Run all three before a commit.
- Development loop: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir
  "$PWD/plugin"` in a real terminal. `-p` has no pane surface. Hook failures
  are fail-open and appear only in `~/.claude/debug/<session>.txt`.
- Design decisions go to `docs/decisions/` as short numbered notes
  (Context / Decision / Consequences).
- Commits are semantic units. Comments say why, not what. Each module starts
  with its responsibility and what it must not know about.
- Adding a dependency: exact pin, released 7 or more days ago with no
  security fix after it, and ask the owner first with the reason.
