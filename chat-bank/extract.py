"""
Pre-process all chat histories into a single conversations.json file.
Run locally before building the Docker image.
"""
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
from server import (
    parse_devin, parse_claude_code, parse_codex, parse_cursor,
    DEVIN_SUMMARIES, CLAUDE_PROJECTS, CODEX_SESSIONS, CODEX_ARCHIVED, CURSOR_VSCDB,
)

print("Extracting all chat histories...")
t0 = time.time()

all_convs = []

print("  Devin...")
all_convs.extend(parse_devin(DEVIN_SUMMARIES))

print("  Claude Code...")
all_convs.extend(parse_claude_code(CLAUDE_PROJECTS))

print("  Codex...")
all_convs.extend(parse_codex(CODEX_SESSIONS, CODEX_ARCHIVED))

print("  Cursor...")
all_convs.extend(parse_cursor(CURSOR_VSCDB))

output = {
    "generated_at": time.time(),
    "total": len(all_convs),
    "conversations": [c.to_dict() for c in all_convs],
}

out_path = os.path.join(os.path.dirname(__file__), "conversations.json")
with open(out_path, "w") as f:
    json.dump(output, f)

size_mb = os.path.getsize(out_path) / 1024 / 1024
print(f"\nDone: {len(all_convs)} conversations, {size_mb:.1f}MB → {out_path}")
print(f"Took {time.time()-t0:.1f}s")

# Print source breakdown
source_counts = {}
for c in all_convs:
    source_counts[c.source] = source_counts.get(c.source, 0) + 1
for src, count in sorted(source_counts.items()):
    print(f"  {src}: {count} conversations")
