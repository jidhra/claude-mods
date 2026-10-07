# Clean View

A Claude Code mod that makes Claude Code calm and friendly for people who aren't technical. While Claude works, tool calls, file diffs and command output are hidden from the transcript. Task tracking lives in Pinboard, not here.

## Install

In a Claude Code terminal session, type:

```
/plugin install clean-view --marketplace jidhra/clean-view
```

Answer `y` to add the marketplace, then press Enter to choose the user scope. The repository is private, so you need access to it on GitHub.

## Turn it on and off

- Clean View starts on.
- Click the **Clean View** button above the prompt, or type `/simple off`, `/simple on`, or `/simple` to flip it.
- Your choice is remembered after a restart.
- When it's off, every hidden row comes back.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
