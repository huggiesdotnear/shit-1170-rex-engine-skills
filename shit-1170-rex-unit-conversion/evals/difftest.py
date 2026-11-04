#!/usr/bin/env python3
"""Differential test: the bun bin and the python bin must agree.

Both bins are the same conversion, so the same input must produce the
same output from both — stdout and stderr alike. The only difference
allowed is the program name in the usage text, which is normalized away.

usage: python3 difftest.py <skill-dir>
"""

import re
import subprocess
import sys
from pathlib import Path

skill = Path(sys.argv[1])
ts = ["bun", str(skill / "bin" / "unit_conversion.ts")]
py = ["python3", str(skill / "bin" / "unit_conversion.py")]


def normalize(text: str) -> str:
    # the program name and interpreter legitimately differ.
    text = re.sub(r"(usage: )?(bun |python3 )?bin/unit_conversion\.[a-z]+", r"\1BIN", text)
    # the api's response height and timestamp move between calls.
    text = re.sub(r'"height": \d+', '"height": 0', text)
    text = re.sub(r'"timestamp_millis": \d+', '"timestamp_millis": 0', text)
    return text


def run(cmd: list[str], args: list[str]) -> tuple[str, str, int]:
    proc = subprocess.run(cmd + args, capture_output=True, text=True)
    return normalize(proc.stdout), normalize(proc.stderr), proc.returncode


cases: list[list[str]] = []

# the pure math, with the decimals given so no api call happens.
for d in (0, 1, 6, 8, 9, 18, 24):
    for amt in (
        "0",
        "1",
        "1.5",
        "0.0004",
        "0.0000005",
        "123456789.987654321",
        "999999999999999999999999",
        "3.14159265358979",
        "0.1",
        "1000000",
    ):
        cases.append(["--ca", "x.near", "--decimal", amt, "--decimals", str(d)])
        cases.append(["--ca", "x.near", "--unit", amt, "--decimals", str(d)])

# the error paths.
cases += [
    ["--ca", "x.near", "--decimal", "1", "--unit", "2", "--decimals", "6"],
    ["--ca", "x.near", "--decimals", "6"],
    ["--ca", "x.near", "--decimal", "1e18", "--decimals", "24"],
    ["--ca", "x.near", "--decimal", "-1", "--decimals", "24"],
    ["--ca", "x.near", "--decimal", "1.2.3", "--decimals", "24"],
    ["--ca", "x.near", "--decimal", "1,000", "--decimals", "24"],
    ["--ca", "x.near", "--unit", "12.5", "--decimals", "24"],
    ["--ca", "x.near", "--unit", "abc", "--decimals", "24"],
    ["--ca", "x.near", "--decimal", "1", "--decimals", "-1"],
    ["--ca", "x.near", "--decimal", "1", "--decimals", "abc"],
    ["--ca", "", "--decimal", "1", "--decimals", "6"],
]

failures = 0
for args in cases:
    a_out, a_err, a_code = run(ts, args)
    b_out, b_err, b_code = run(py, args)
    if (a_out, a_err, a_code) != (b_out, b_err, b_code):
        failures += 1
        print(f"MISMATCH: {' '.join(args)}")
        if a_out != b_out:
            print(f"  ts stdout: {a_out[:300]!r}")
            print(f"  py stdout: {b_out[:300]!r}")
        if a_err != b_err:
            print(f"  ts stderr: {a_err[:300]!r}")
            print(f"  py stderr: {b_err[:300]!r}")
        if a_code != b_code:
            print(f"  ts exit: {a_code}  py exit: {b_code}")

print(f"\n{len(cases) - failures}/{len(cases)} cases match")
sys.exit(1 if failures else 0)
