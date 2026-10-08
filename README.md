# claude-mods

All of my Claude Code mods in one plugin marketplace.

## Install

```
claude plugin marketplace add jidhra/claude-mods
claude plugin install <mod>@claude-mods --scope user
```

## Mods

| Mod | Folder | Origin |
|---|---|---|
| Mod Tools | `plugins/mod-tools` | mine |
| Clean View | `plugins/clean-view` | mine |
| Usage | `plugins/usage-pane` | mine |
| Pinboard | `plugins/pinboard` | personal copy of [sirkitree/pinboard](https://github.com/sirkitree/pinboard) (MIT) |
| Buffer Pane | `plugins/buffer-pane` (plugin in `plugin/`) | personal copy of [meganemura/buffer-pane](https://github.com/meganemura/buffer-pane) (MIT) |
| Flightdeck | `plugins/flightdeck` | copy of [scasella/claude-flightdeck](https://github.com/scasella/claude-flightdeck) (MIT) |
| Secret Redactor | `plugins/secret-redactor` | copy of `plugins/secret-redactor` from [ray-amjad/awesome-claude-code-function-hooks](https://github.com/ray-amjad/awesome-claude-code-function-hooks) (MIT) |

Each mod was brought in with `git subtree`, so its full history is here. The mods by other authors keep tracking their originals; see [UPSTREAM.md](UPSTREAM.md) for pulling in their changes.

The `.claude-plugin/marketplace.json` files inside each mod's folder are left over from when each was its own marketplace. Only the one at the repo root is used.

## Develop

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
