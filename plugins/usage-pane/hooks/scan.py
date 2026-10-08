"""Today/week token stats across every Claude Code session on this machine.

Reads the transcripts under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects)
touched in the last 8 days and prints one JSON object on stdout for the Usage
pane's LOCAL card. Each file is read from where the last scan stopped: the
byte offsets and per-day totals are cached in ~/.cache/usage-pane/scan.json,
so a scan after the first only parses what was appended since.

Standard library only; run it with `python3 -I`.
"""

import datetime as dt
import json
import os
import sys
import time

WINDOW_DAYS = 8
CACHE_VERSION = 1


def projects_dir(argv):
    if len(argv) > 1:
        return argv[1]
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    return os.path.join(base, "projects")


def cache_path(argv):
    if len(argv) > 2:
        return argv[2]
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(base, "usage-pane", "scan.json")


def local_day(stamp):
    """`2026-10-08T18:32:21.295Z` → the local calendar day, `2026-10-08`."""
    try:
        when = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return when.astimezone().date().isoformat()


def is_prompt(entry):
    """A person's typed prompt: a main-thread user row with text and no tool result."""
    if entry.get("isSidechain") or entry.get("isMeta"):
        return False
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        return bool(content.strip()) and not content.startswith("<")
    if isinstance(content, list):
        kinds = {block.get("type") for block in content if isinstance(block, dict)}
        return "text" in kinds and "tool_result" not in kinds
    return False


def empty_day():
    return {"tokens": 0, "prompts": 0, "models": {}}


def read_new(path, record, is_top_level):
    """Parses the lines appended to `path` since `record["offset"]` into `record["days"]`."""
    days = record.setdefault("days", {})
    recent = record.setdefault("recent", [])
    with open(path, "rb") as handle:
        handle.seek(record.get("offset", 0))
        while True:
            line = handle.readline()
            # A line still being written has no newline yet: read it next time
            if not line or not line.endswith(b"\n"):
                break
            record["offset"] = handle.tell()
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            kind = entry.get("type")
            day = local_day(entry.get("timestamp"))
            if day is None:
                continue
            if kind == "user" and is_top_level and is_prompt(entry):
                days.setdefault(day, empty_day())["prompts"] += 1
            if kind != "assistant":
                continue
            message = entry.get("message") or {}
            usage = message.get("usage")
            if not isinstance(usage, dict):
                continue
            # A response is written once per content block, each row carrying the same usage
            msg_id = message.get("id")
            if msg_id and msg_id in recent:
                continue
            if msg_id:
                recent.append(msg_id)
                del recent[:-64]
            tokens = sum(
                int(usage.get(key) or 0)
                for key in ("input_tokens", "cache_creation_input_tokens", "output_tokens")
            )
            if tokens <= 0:
                continue
            bucket = days.setdefault(day, empty_day())
            bucket["tokens"] += tokens
            model = message.get("model") or "unknown"
            if not model.startswith("<"):
                bucket["models"][model] = bucket["models"].get(model, 0) + tokens
            if is_top_level:
                bucket["active"] = True


def scan(root, cache_file, now=None):
    now = now or time.time()
    cutoff = now - WINDOW_DAYS * 86400
    try:
        with open(cache_file) as handle:
            cache = json.load(handle)
        if cache.get("version") != CACHE_VERSION:
            raise ValueError
    except (OSError, ValueError):
        cache = {"version": CACHE_VERSION, "files": {}}
    files = cache["files"]
    seen = set()

    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(dirpath, name)
            try:
                stat = os.stat(path)
            except OSError:
                continue
            if stat.st_mtime < cutoff:
                continue
            seen.add(path)
            record = files.get(path)
            # A file that shrank was rewritten: start it over
            if record is None or stat.st_size < record.get("offset", 0):
                record = files[path] = {"offset": 0}
            if stat.st_size == record.get("offset", 0):
                continue
            # Subagent transcripts sit a level down, under <session>/subagents/
            is_top_level = os.path.dirname(dirpath) == root.rstrip(os.sep)
            try:
                read_new(path, record, is_top_level)
            except OSError:
                continue

    for path in [p for p in files if p not in seen]:
        del files[path]

    today = dt.date.fromtimestamp(now)
    week_days = [(today - dt.timedelta(days=n)).isoformat() for n in range(7)]
    totals = {day: {"tokens": 0, "prompts": 0, "sessions": 0} for day in week_days}
    models = {}
    for record in files.values():
        for day, bucket in record.get("days", {}).items():
            if day not in totals:
                continue
            totals[day]["tokens"] += bucket["tokens"]
            totals[day]["prompts"] += bucket["prompts"]
            if bucket.get("active") or bucket["prompts"]:
                totals[day]["sessions"] += 1
            for model, tokens in bucket["models"].items():
                models[model] = models.get(model, 0) + tokens
        # Drop days that have aged out, so the cache stays small
        record["days"] = {d: b for d, b in record.get("days", {}).items() if d >= week_days[-1]}

    try:
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        temp = cache_file + ".tmp"
        with open(temp, "w") as handle:
            json.dump(cache, handle)
        os.replace(temp, cache_file)
    except OSError:
        pass

    week = {key: sum(totals[d][key] for d in week_days) for key in ("tokens", "prompts")}
    week["sessions"] = sum(
        1 for record in files.values() if any(d in totals and (b.get("active") or b["prompts"]) for d, b in record.get("days", {}).items())
    )
    busiest = max(week_days, key=lambda d: totals[d]["tokens"])
    return {
        "today": totals[week_days[0]],
        "week": week,
        "topModel": max(models, key=models.get) if models else None,
        "busiestDay": busiest if totals[busiest]["tokens"] > 0 else None,
        "byDay": [{"day": d, "tokens": totals[d]["tokens"]} for d in reversed(week_days)],
    }


if __name__ == "__main__":
    print(json.dumps(scan(projects_dir(sys.argv), cache_path(sys.argv))))
