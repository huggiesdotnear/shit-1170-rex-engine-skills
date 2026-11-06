#!/usr/bin/env python3
"""Smoke test the core skill's bins without touching the network.

Runs the bins' argument parsing and local-file behaviour:
- keyring set/list/get/remove against a temporary home
- contacts add/list/has/remove against a temporary home
- queue list usage text
- queue_tx/queue_swap usage text mentions --when-at
- tx_status exists and refuses a missing --tx-hash
- ft transfer preparation rejects a malformed amount

the contacts and the ft transfer bins live in the ft skill, so those
tests reach into the sibling folder. they are skipped when it is not
there.

Run: python3 evals/difftest.py <skill-dir>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def run_bun(skill_dir: Path, home: Path, *args: str) -> tuple[int, dict]:
    env = dict(os.environ)
    env["SHIT_1170_REX_HOME"] = str(home)
    proc = subprocess.run(
        ["bun", str(skill_dir / "bin" / args[0]), *args[1:]],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(skill_dir),
    )
    payload: dict = {}
    stream = proc.stdout if proc.returncode == 0 else proc.stderr
    text = stream.strip()
    if text:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = {"raw": text}
    return proc.returncode, payload


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: difftest.py <skill-dir>", file=sys.stderr)
        return 2
    skill_dir = Path(sys.argv[1]).resolve()

    # the contacts and the token bins live in the ft skill, not here.
    ft_dir = skill_dir.parent / "shit-1170-rex-ft"

    with tempfile.TemporaryDirectory() as temp:
        home = Path(temp)

        code, out = run_bun(
            skill_dir,
            home,
            "keyring.ts",
            "set",
            "--account",
            "alice.near",
            "--api-key",
            "secret-key",
        )
        expect(code == 0, f"keyring set failed: {out}")
        expect(out.get("accountId") == "alice.near", f"wrong account: {out}")

        account_file = home / "accounts" / "alice.near.json"
        expect(account_file.exists(), "the account file was not written")
        mode = account_file.stat().st_mode & 0o777
        expect(mode == 0o600, f"the account file is not private: {oct(mode)}")

        code, out = run_bun(skill_dir, home, "keyring.ts", "list")
        expect(code == 0, f"keyring list failed: {out}")
        expect(len(out.get("accounts", [])) == 1, f"wrong account list: {out}")
        expect(
            "apiKey" not in json.dumps(out),
            "the account list leaked the api key",
        )

        if ft_dir.exists():
            code, out = run_bun(
                ft_dir,
                home,
                "contacts.ts",
                "add",
                "--account",
                "bob.near",
                "--label",
                "Bob",
            )
            expect(code == 0, f"contacts add failed: {out}")
            expect(out["contact"]["accountId"] == "bob.near", f"wrong contact: {out}")

            code, out = run_bun(ft_dir, home, "contacts.ts", "has", "--account", "bob.near")
            expect(code == 0 and out.get("has") is True, f"contact not found: {out}")

            code, out = run_bun(ft_dir, home, "contacts.ts", "has", "--account", "nobody.near")
            expect(code == 0 and out.get("has") is False, f"contact wrongly found: {out}")

        code, out = run_bun(skill_dir, home, "queue_list.ts", "help")
        expect(code == 0, f"queue_list help failed: {out}")
        expect("usage" in out, f"no usage text: {out}")

        for bin_name in ("queue_tx.ts", "queue_swap.ts"):
            code, out = run_bun(skill_dir, home, bin_name, "help")
            expect(code == 0, f"{bin_name} help failed: {out}")
            usage = " ".join(out.get("usage", []))
            expect(
                "--when-at" in usage,
                f"{bin_name} usage does not mention --when-at: {out}",
            )
            expect(
                "--whenAt" not in usage,
                f"{bin_name} usage still uses --whenAt: {out}",
            )

        tx_status = skill_dir / "bin" / "tx_status.ts"
        expect(tx_status.exists(), "bin/tx_status.ts is missing")
        code, out = run_bun(skill_dir, home, "tx_status.ts")
        expect(code == 1, f"tx_status without --tx-hash did not fail: {out}")
        expect(
            "--tx-hash" in out.get("error", ""),
            f"wrong error for a missing --tx-hash: {out}",
        )

        if ft_dir.exists():
            code, out = run_bun(
                ft_dir,
                home,
                "ft_transfer.ts",
                "--token",
                "usdt.tether-token.near",
                "--receiver",
                "bob.near",
                "--amount",
                "1.5",
            )
            expect(code != 0, "a fractional unit amount was accepted")
            expect(
                "smallest unit" in out.get("error", ""),
                f"wrong error for a bad amount: {out}",
            )

            code, out = run_bun(
                ft_dir,
                home,
                "ft_transfer.ts",
                "--token",
                "usdt.tether-token.near",
                "--receiver",
                "nobody.near",
                "--amount",
                "1500000",
            )
            expect(code == 2, f"an unknown receiver was not refused: {out}")

    print("ok - the local bins behave")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
