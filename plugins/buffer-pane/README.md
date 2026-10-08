# buffer-pane

[![test](https://github.com/meganemura/buffer-pane/actions/workflows/test.yml/badge.svg)](https://github.com/meganemura/buffer-pane/actions/workflows/test.yml)

A Claude Code plugin (a Claude Mod) that opens a pane beside the transcript
where you write the next things to tell the agent.

An idea for the next request frequently comes while the agent runs a long
turn. Text in the prompt box is one Enter away from the agent: Enter
interrupts the turn or puts the text in the queue. The pane is a place to
collect that text until you are ready.

- Write blocks of text in the pane while a turn runs.
- Press `[+]` beside a block to put that block into the prompt box, read it,
  then press Enter yourself.
- Press `[>]` to send the block as a prompt in one press.
- The buffer survives sessions. Each working directory has its own buffer.

## Requirements

- Claude Code 2.1.273 or later with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
- A terminal session. Print mode (`-p`) has no pane.

## Install

```sh
claude plugin marketplace add meganemura/buffer-pane
claude plugin install buffer-pane@buffer-pane
```

To develop against a checkout, run the plugin from its working tree:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/buffer-pane/plugin
```

To set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` for each session, add it to the
`env` of `settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

## Use

Type `/buffer-pane` to show the pane. Type it again to hide the pane.

```
[+] [>] [x] [^] [v]   rename the flag to --dry-run
[+] [>] [x] [^] [v] ✓ add a test for the empty list
                      the next thing to tell the agent

[+] replaces the prompt box with the block. [>] sends the block as a prompt. [x] deletes the block. [^] [v] move the block.
```

- **Add a block.** Type in the last field and press Enter. The block goes
  above the field, and the field becomes empty for the next block.
- **Edit a block.** Move the focus to the field of the block and type. The
  pane saves each change.
- **Put a block into the prompt box.** Press `[+]`. The block goes into the
  prompt box and stays in the pane with a `✓`. You can send the block again.
  An edit to the block removes the `✓`.
- **Send a block as a prompt.** Press `[>]`. The block goes to the agent as
  your next prompt and leaves the pane. During a turn, it waits in the queue
  until the turn ends.
- **Move a block.** Press `[^]` to move it up one place, `[v]` to move it
  down.
- **Delete a block.** Press `[x]`. You can also make the field empty and press
  Enter.

To press a control, click it, or move the focus to it with the arrow keys and
press Enter.

### `[+]` replaces the prompt box

`[+]` replaces all the text in the prompt box with the block. The
function-hooks API can only replace the box, and it cannot read the box, so
the plugin cannot warn you about text that is already there. Send a block
when the prompt box is empty.

When a dialog is open, the prompt box cannot take the text. The status line
then shows a message, and the block gets no `✓`.

### Blocks

The buffer is one text, and blank lines split it into blocks. In this
version, one block is one line. A multi-line editor is the next milestone
([decision 0003](docs/decisions/0003-one-line-fields-first-then-a-multi-line-editor.md)).

### Where the buffer lives

The plugin store of Claude Code holds the buffer under the key
`buffer:<working directory>`. A session in another directory shows another
buffer.

## Development

Run `/plugin-types` one time in a new checkout. It writes the type
declarations to `.claude/types/`, which git ignores.

Run the three quality gates before a commit:

```sh
claude plugin validate plugin
npx -p typescript tsc -p plugin/hooks
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugin
```

`docs/decisions/` holds the design decisions. `AGENTS.md` holds the rules for
changes to this repository.

## Status

Early access. The function-hooks API can change between Claude Code releases
without notice.
