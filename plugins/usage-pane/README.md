<div align="center">

# Usage

**How much of your Claude plan is left, and how much this session spent.**<br>
A pane beside the conversation with the 5-hour and weekly limits, this session's share of them, and token stats across every session on the machine.

[![Version](https://img.shields.io/badge/version-0.1.0-d77757.svg)](.claude-plugin/plugin.json)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-c678dd.svg)](https://code.claude.com/docs/en/plugins/mods/overview)
[![Claude Code 2.1.294+](https://img.shields.io/badge/Claude%20Code-2.1.294%2B-4a4a4a.svg)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-4eba65.svg)](LICENSE)

</div>

Usage looks like its siblings Pinboard, Flightdeck and Buffer pane. Its layout follows the Agents panel in Omarchy: one line per limit window, with a meter and the time until that window resets.

```
          USAGE · 42% 5H · 18% WEEK
       ■ limits  ■ session  ■ local
╭──────────────────────────────────────────────╮
│ LIMITS · account                   resets in │
│ Session (5h)  ▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱  42%  2h 10m │
│ Weekly        ▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱  18%   4d 3h │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ THIS SESSION · 1h 12m                  $3.41 │
│ 5h used       ▰▰▱▱▱▱ +7.5 pts of 42%         │
│ 7d used       ▱▱▱▱▱▱ +1.2 pts of 18%         │
│ tokens        1.2M in · 48k out · 980k cached│
│ turns         14 · prompts 9 · ctx ▰▱▱▱ 31%  │
│ models        Opus 5.5 82% · Haiku 4.5 18%   │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ LOCAL · all sessions          2m ago refresh │
│ today         1.8M tok · 33 prompts · 15 ses │
│ this week     21.8M tok · 158 prompts · 65 s │
│ by day        █▂▁▁▇▁▂  busiest Fri           │
│ mostly        Opus 5.5                       │
╰──────────────────────────────────────────────╯
```

## The cards

- **Limits**: one line for each rate-limit window your plan reports: `Session (5h)`, `Weekly`, and any model-scoped weekly window such as `Fable weekly`. Each line shows a meter, the percentage, and the time until that window resets. The meter turns to the warning colour at 70% and to the error colour at 90%. These are the same figures `/status` shows in its Usage tab. The engine passes them to mods through `$.session.usage()` and the `session.measure` event, so the pane makes no API calls of its own.
- **This session**: how long the session has run, its cost (the `/cost` total), and how far each window has moved since the session began, in percentage points. A window that resets partway through the session carries its points forward. Below that are the tokens from every model request, both the main thread's and each subagent's (`in` covers uncached input plus cache writes, and `cached` is cache reads), then turns, prompts, the context fill, and each model's share of the tokens.
- **Local**: every Claude Code session on this machine, read from the transcripts in `~/.claude/projects`. It shows today's and this week's tokens, prompts and sessions, a 7-day sparkline, the busiest day, and the model used most. Here, tokens means input plus cache writes plus output. Cache reads are left out because they would swamp the rest.

### What "+N pts" means

Rate limits apply to the whole account, so the engine only reports the account's total. The session's share is the points each window moved after the session started. **Any other Claude session running on the same account at the same time is included.** With one session running, the figure is exact.

## How it gets its numbers

- **Limits and cost** come from `session.measure`, which fires after each main-thread turn and whenever a window moves a whole point.
- **Tokens** come from `turn.step`, using the usage the API reported for each request.
- **Local stats** come from `hooks/scan.py`, which needs only the Python standard library. It runs when the pane opens, every 5 minutes while the pane is open, and whenever you press `r`. It reads only the transcripts touched in the last 8 days, and it reads each file from where the last scan stopped. Its byte offsets and per-day totals are cached in `~/.cache/usage-pane/scan.json`. The first scan of about 300 MB takes around 1.3 s; later scans take about 0.1 s.

## Open and close

- `/usage-pane` toggles the pane. `/usage-pane open` and `/usage-pane close` open and close it.
- Mod Tools' **Show** column (`/tools`) toggles it too.
- The pane never opens on its own. Flightdeck is the only mod that opens unasked.

## Install

```bash
claude plugin marketplace add jidhra/claude-mods
claude plugin install usage-pane@claude-mods --scope user
```

## Develop

```bash
claude plugin validate .
claude plugin test .
python3 -m unittest discover -s tests
```
