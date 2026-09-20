#!/usr/bin/env python3
"""Fails (exit 1) if the submission still has placeholders or is missing required proof.
Run before flipping public / submitting the BUIDL."""
import json, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
errs = []
def check(cond, msg):
    if not cond: errs.append(msg)

# 1. no leftover placeholders in judge-facing docs
PLACEHOLDER = re.compile(r"\b(TODO|TBD|FIXME|youtu\.be/xxx|0x\.\.\.|\[filled|\[fill|lorem ipsum)\b", re.I)
for name in ["README.md", "DEMO.md", "docs/DX-REPORT.md", "ARCHITECTURE.md"]:
    p = root / name
    if p.exists():
        for i, line in enumerate(p.read_text().splitlines(), 1):
            if PLACEHOLDER.search(line): errs.append(f"{name}:{i} placeholder: {line.strip()[:80]}")

# 2. deployment facts present
dep = root / "deployments/arc-mainnet.json"
check(dep.exists(), "deployments/arc-mainnet.json missing")
if dep.exists():
    d = json.loads(dep.read_text())
    check(re.fullmatch(r"0x[0-9a-fA-F]{40}", d.get("factory","")), "factory address missing/invalid")
    check(d.get("chainId") == 5042, "chainId != 5042")

# 3. bench results present with real numbers
bench = root / "bench/results.json"
check(bench.exists(), "bench/results.json missing (run scripts/bench.sh)")
if bench.exists():
    b = json.loads(bench.read_text())
    check(b.get("movingSweepGas",{}).get("n",0) >= 10, "bench n<10 — run a real benchmark")

# 4. README must state a live URL and the test count
readme = root / "README.md"
if readme.exists():
    t = readme.read_text()
    check("pigeonhole.edycu.dev" in t or "http" in t, "README has no live URL")
    check(re.search(r"\b\d+\s+tests?\b", t, re.I), "README does not state a test count")
else:
    errs.append("README.md missing")

if errs:
    print("SUBMISSION NOT READY:"); [print("  -", e) for e in errs]; sys.exit(1)
print("submission readiness: OK"); sys.exit(0)
