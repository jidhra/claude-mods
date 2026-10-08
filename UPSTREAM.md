# Pulling upstream changes

Mods by other authors live under `plugins/` as git subtrees. Each original has a fetch-only remote (push is set to `DISABLED`):

| Mod | Remote | Branch |
|---|---|---|
| pinboard | `upstream-pinboard` → sirkitree/pinboard | `main` |
| buffer-pane | `upstream-buffer-pane` → meganemura/buffer-pane | `main` |
| flightdeck | `upstream-flightdeck` → scasella/claude-flightdeck | `main` |
| secret-redactor | `upstream-function-hooks` → ray-amjad/awesome-claude-code-function-hooks | `main`, folder `plugins/secret-redactor` |
| kindex | `upstream-kindex` → wandercom/kindex | `main`, squashed |

A fresh clone needs the remotes added again:

```sh
git remote add upstream-pinboard https://github.com/sirkitree/pinboard.git
git remote add upstream-buffer-pane https://github.com/meganemura/buffer-pane.git
git remote add upstream-flightdeck https://github.com/scasella/claude-flightdeck.git
git remote add upstream-function-hooks https://github.com/ray-amjad/awesome-claude-code-function-hooks.git
git remote add upstream-kindex https://github.com/wandercom/kindex.git
for r in upstream-pinboard upstream-buffer-pane upstream-flightdeck upstream-function-hooks upstream-kindex; do git remote set-url --push $r DISABLED; done
```

## Whole-repo mods (pinboard, buffer-pane, flightdeck)

```sh
git fetch upstream-pinboard
git subtree pull --prefix=plugins/pinboard upstream-pinboard main
```

Swap in `buffer-pane` / `flightdeck` for the others. Resolve any conflicts with my own changes, run `claude plugin test plugins/<mod>`, then push.

## secret-redactor (one folder of a bigger repo)

Split the folder out of upstream into a branch, then pull that branch:

```sh
git fetch upstream-function-hooks
git branch -f sr-upstream upstream-function-hooks/main
git subtree split --prefix=plugins/secret-redactor sr-upstream -b sr-split   # use -b once; later runs: git branch -f sr-split $(git subtree split --prefix=plugins/secret-redactor sr-upstream)
git subtree pull --prefix=plugins/secret-redactor . sr-split
```

The split is deterministic, so later pulls only bring in new commits.

## kindex (squashed)

kindex was added with `--squash` to keep its thousands of upstream commits out of this repo's history. Every pull must use `--squash` too:

```sh
git fetch upstream-kindex
git subtree pull --prefix=plugins/kindex upstream-kindex main --squash
```

The plugin calls the `kin` and `kin-mcp` installed on PATH, so upgrade the package to the same version at the same time: `uv tool upgrade kindex`.
