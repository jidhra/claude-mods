# Clean View

A Claude Code mod that makes Claude Code calm and friendly for people who aren't technical. While Claude works, tool calls, file diffs and command output are hidden from the transcript. Task tracking lives in Pinboard, not here.

## Install

In a Claude Code terminal session, type:

```
/plugin install clean-view --marketplace jidhra/claude-mods
```

Answer `y` to add the marketplace, then press Enter to choose the user scope.

## Turn it on and off

- Clean View starts on.
- Type `/simple off`, `/simple on`, or `/simple` to flip it, or use the Clean View switch in Jidhra's Tools.
- Your choice is remembered after a restart.
- When it's off, every hidden row comes back.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
