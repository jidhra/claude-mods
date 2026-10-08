"""python3 -m unittest discover -s tests  (from the plugin folder)"""

import datetime as dt
import importlib.util
import json
import os
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("scan", os.path.join(HERE, "..", "hooks", "scan.py"))
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


def stamp(when):
    return when.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def assistant(msg_id, when, tokens, model="claude-opus-5-5", sidechain=False):
    return {
        "type": "assistant",
        "isSidechain": sidechain,
        "timestamp": stamp(when),
        "message": {
            "id": msg_id,
            "model": model,
            "usage": {"input_tokens": tokens, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 999},
        },
    }


def prompt(text, when):
    return {"type": "user", "timestamp": stamp(when), "message": {"role": "user", "content": text}}


def tool_result(when):
    return {"type": "user", "timestamp": stamp(when), "message": {"content": [{"type": "tool_result", "content": "ok"}]}}


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "projects")
        self.cache = os.path.join(self.tmp.name, "cache", "scan.json")
        self.now = dt.datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, rows, mode="w"):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, mode) as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        return path

    def test_counts_today_week_and_dedupes_repeated_blocks(self):
        yesterday = self.now - dt.timedelta(days=1)
        self.write(
            "proj/s1.jsonl",
            [
                prompt("hello", self.now),
                tool_result(self.now),
                # One response written once per content block
                assistant("m1", self.now, 100),
                assistant("m1", self.now, 100),
                assistant("m2", yesterday, 500, model="claude-haiku-4-5-20251001"),
                prompt("again", yesterday),
            ],
        )
        self.write("proj/s1/subagents/agent-a.jsonl", [assistant("m3", self.now, 50, sidechain=True)])
        out = scan.scan(self.root, self.cache, now=self.now.timestamp())
        self.assertEqual(out["today"], {"tokens": 150, "prompts": 1, "sessions": 1})
        self.assertEqual(out["week"]["tokens"], 650)
        self.assertEqual(out["week"]["prompts"], 2)
        self.assertEqual(out["topModel"], "claude-haiku-4-5-20251001")
        self.assertEqual(out["busiestDay"], yesterday.date().isoformat())
        self.assertEqual(len(out["byDay"]), 7)

    def test_second_scan_reads_only_what_was_appended(self):
        path = self.write("proj/s1.jsonl", [assistant("m1", self.now, 100)])
        scan.scan(self.root, self.cache, now=self.now.timestamp())
        self.write("proj/s1.jsonl", [assistant("m1", self.now, 100), assistant("m2", self.now, 7)], mode="a")
        out = scan.scan(self.root, self.cache, now=self.now.timestamp())
        self.assertEqual(out["today"]["tokens"], 107)
        with open(self.cache) as handle:
            self.assertEqual(json.load(handle)["files"][path]["offset"], os.path.getsize(path))

    def test_old_files_and_partial_lines_are_skipped(self):
        old = self.write("proj/old.jsonl", [assistant("m9", self.now, 1000)])
        past = time.time() - 30 * 86400
        os.utime(old, (past, past))
        path = self.write("proj/s1.jsonl", [assistant("m1", self.now, 10)])
        with open(path, "a") as handle:
            handle.write('{"type": "assistant", "partial')
        out = scan.scan(self.root, self.cache, now=self.now.timestamp())
        self.assertEqual(out["week"]["tokens"], 10)


if __name__ == "__main__":
    unittest.main()
