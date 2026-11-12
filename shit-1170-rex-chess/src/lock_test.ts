// the daemon's lock, tested against the second daemon it must refuse.
//
// --- WHY THIS FILE EXISTS ---
// one daemon plays one account. a second daemon on the same account
// reads the same board, picks its own move, and sends it — and one of
// the two moves is always stale by the time it lands, because the
// contract checks the move against the board as it is at that moment.
// the loser of that race pays gas for an "Illegal move".
//
// so the daemon claims a lock, and a second one is told plainly that
// the account is already being played.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  shit_1170_chess_lock_claim_fun,
  shit_1170_chess_lock_holder_fun,
} from "./store";
import { shit_1170_chess_lock_path_fun } from "./paths";

function scratch_home_fun(): void {
  const home = mkdtempSync(join(tmpdir(), "rex-chess-lock-test-"));
  process.env.SHIT_1170_REX_HOME = home;
}

describe("the daemon's lock", () => {
  test("the first daemon claims it", () => {
    scratch_home_fun();

    const lock = shit_1170_chess_lock_claim_fun("a.near");
    const holder = shit_1170_chess_lock_holder_fun(
      shit_1170_chess_lock_path_fun(),
    );

    expect(holder).not.toBeNull();
    expect(holder?.pid).toBe(process.pid);
    expect(holder?.account_id).toBe("a.near");

    lock.release();
  });

  test("a second daemon on the same account is refused", () => {
    scratch_home_fun();

    const lock = shit_1170_chess_lock_claim_fun("a.near");

    let message = "";
    try {
      shit_1170_chess_lock_claim_fun("a.near");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("already being played");
    expect(message).toContain(String(process.pid));

    lock.release();
  });

  test("the lock is free again after it is released", () => {
    scratch_home_fun();

    const lock = shit_1170_chess_lock_claim_fun("a.near");
    lock.release();

    const second = shit_1170_chess_lock_claim_fun("a.near");
    expect(
      shit_1170_chess_lock_holder_fun(shit_1170_chess_lock_path_fun())?.pid,
    ).toBe(process.pid);
    second.release();
  });

  test("a lock left behind by a daemon that died is taken over", () => {
    scratch_home_fun();

    // a pid that is not running. the lock is stale, and a stale lock
    // must not block the account forever.
    mkdirSync(dirname(shit_1170_chess_lock_path_fun()), { recursive: true });
    writeFileSync(
      shit_1170_chess_lock_path_fun(),
      JSON.stringify({ account_id: "a.near", pid: 999_999, at: Date.now() }),
    );

    const lock = shit_1170_chess_lock_claim_fun("a.near");
    expect(
      shit_1170_chess_lock_holder_fun(shit_1170_chess_lock_path_fun())?.pid,
    ).toBe(process.pid);
    lock.release();
  });
});
