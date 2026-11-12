// the key selection, tested against the keys that cannot work.
//
// --- WHY THIS FILE EXISTS ---
// a key that the agent holds, on the right account, on the right
// contract — and that still cannot make a single call — is the
// failure mode this file is about.
//
// two things make a key unusable, and neither is visible in the key
// itself:
//
//   - the ALLOWANCE. it is the prepaid gas, not the deposit. the
//     contract takes gas_limit x gas_price from it before the call
//     runs, so an allowance of 0 is refused with NotEnoughAllowance
//     before the contract is reached.
//   - the METHOD LIST. a key without play_move cannot play, and a key
//     without join_matchmaking cannot queue for a match.
//
// and one thing makes a key STALE: it was removed from the account.
//
// the signer used to accept any of those and fail later, on chain,
// with an error the agent has to decode. it refuses them here, with a
// message that says what to do.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { shit_1170_chess_signer_find_fun } from "./signer";
import {
  SHIT_1170_CHESS_KEY_ALLOWANCE,
  SHIT_1170_CHESS_KEY_METHODS,
} from "./payload";

// a private key that is never used to sign anything. the tests only
// need the agent to HOLD it.
const TEST_SECRET =
  "ed25519:3D4YudUahF5AAtPmwYHqXNZgJEPoAXWC1PDzrJ8fnmyM2rXq3EHYiLx6d5L3iHmzsPGYjnLK1K9UXgW6Pvbzoqk";

interface SEED_KEY {
  public_key: string;
  method_names: string[];
  allowance: string | null;
  action?: string;
}

/**
 * build a scratch home with the given keys in it, and point the skill
 * at it.
 *
 * the store is a directory per key under `keys/added/`, and the
 * secrets live in `keys/keys.sqlite` — the same two places the keys
 * skill writes.
 *
 * the home is a fresh directory per call, so one test never sees
 * another's keys.
 */
function seed_store(keys: SEED_KEY[], hold_secrets = true): string {
  const home = mkdtempSync(join(tmpdir(), "rex-chess-key-test-"));
  process.env.SHIT_1170_REX_HOME = home;

  const added = join(home, "keys", "added");
  mkdirSync(added, { recursive: true });

  for (const key of keys) {
    writeFileSync(
      join(added, `ed25519_${key.public_key.replace(/[:]/g, "_")}.json`),
      JSON.stringify({
        public_key: key.public_key,
        account_id: "a.near",
        receiver_id: "app.chess-game.near",
        method_names: key.method_names,
        allowance: key.allowance,
        action: key.action ?? "add_key",
      }),
    );
  }

  const db = new Database(join(home, "keys", "keys.sqlite"));
  db.run(
    "CREATE TABLE IF NOT EXISTS keys (public_key TEXT PRIMARY KEY, secret_key TEXT, seed_phrase TEXT, derivation_path TEXT)",
  );
  if (hold_secrets) {
    for (const key of keys) {
      db.run("INSERT OR REPLACE INTO keys VALUES (?, ?, NULL, NULL)", [
        key.public_key,
        TEST_SECRET,
      ]);
    }
  }
  db.close();

  return home;
}

/**
 * write one more key record into the current home.
 *
 * the record is stamped a second after the ones already there, so the
 * order does not depend on the clock's resolution.
 */
function add_record_fun(
  home: string,
  public_key: string,
  method_names: string[],
  allowance: string | null,
): void {
  const path = join(
    home,
    "keys",
    "added",
    `ed25519_${public_key.replace(/[:]/g, "_")}.json`,
  );
  writeFileSync(
    path,
    JSON.stringify({
      public_key,
      account_id: "a.near",
      receiver_id: "app.chess-game.near",
      method_names,
      allowance,
      action: "add_key",
    }),
  );

  // stamp the new record a second after the ones already there, so
  // the order does not depend on the clock's resolution.
  const stamp = Date.now() / 1000 + 1;
  utimesSync(path, stamp, stamp);

  // the agent holds this key too.
  const db = new Database(join(home, "keys", "keys.sqlite"));
  db.run("INSERT OR REPLACE INTO keys VALUES (?, ?, NULL, NULL)", [
    public_key,
    TEST_SECRET,
  ]);
  db.close();
}

function message_fun(home: string): string {
  process.env.SHIT_1170_REX_HOME = home;
  try {
    shit_1170_chess_signer_find_fun("a.near");
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

function signer_fun(home: string): string {
  process.env.SHIT_1170_REX_HOME = home;
  return shit_1170_chess_signer_find_fun("a.near").public_key;
}

describe("the key the agent signs with", () => {
  test("a key with a real allowance and the full method list is used", () => {
    const home = seed_store([
      {
        public_key: "ed25519:GOOD",
        method_names: [...SHIT_1170_CHESS_KEY_METHODS],
        allowance: SHIT_1170_CHESS_KEY_ALLOWANCE,
      },
    ]);

    process.env.SHIT_1170_REX_HOME = home;
    const signer = shit_1170_chess_signer_find_fun("a.near");
    expect(signer.public_key).toBe("ed25519:GOOD");
    expect(signer.receiver_id).toBe("app.chess-game.near");
  });

  test("a key with an allowance of 0 is refused, and the message says why", () => {
    const home = seed_store([
      {
        public_key: "ed25519:NOALLOWANCE",
        method_names: [...SHIT_1170_CHESS_KEY_METHODS],
        allowance: "0",
      },
    ]);

    const message = message_fun(home);
    expect(message).toContain("allowance of 0");
    expect(message).toContain("PREPAID GAS");
  });

  test("a key without play_move is refused, and the message says why", () => {
    const home = seed_store([
      {
        public_key: "ed25519:NOPLAY",
        method_names: ["ft_transfer"],
        allowance: SHIT_1170_CHESS_KEY_ALLOWANCE,
      },
    ]);

    const message = message_fun(home);
    expect(message).toContain("without the methods this skill calls");
  });

  test("a key that was removed from the account is refused", () => {
    const home = seed_store([
      {
        public_key: "ed25519:REMOVED",
        method_names: [...SHIT_1170_CHESS_KEY_METHODS],
        allowance: SHIT_1170_CHESS_KEY_ALLOWANCE,
        action: "delete_key",
      },
    ]);

    const message = message_fun(home);
    expect(message).toContain("removed from it");
  });

  test("a key the agent does not hold is refused", () => {
    const home = seed_store(
      [
        {
          public_key: "ed25519:NOTHELD",
          method_names: [...SHIT_1170_CHESS_KEY_METHODS],
          allowance: SHIT_1170_CHESS_KEY_ALLOWANCE,
        },
      ],
      false,
    );

    const message = message_fun(home);
    expect(message).toContain("does not hold its private key");
  });

  test("a usable key wins over a broken one in the same store", () => {
    const home = seed_store([
      {
        public_key: "ed25519:BROKEN",
        method_names: [...SHIT_1170_CHESS_KEY_METHODS],
        allowance: "0",
      },
      {
        public_key: "ed25519:WORKING",
        method_names: [...SHIT_1170_CHESS_KEY_METHODS],
        allowance: SHIT_1170_CHESS_KEY_ALLOWANCE,
      },
    ]);

    expect(signer_fun(home)).toBe("ed25519:WORKING");
  });

  test("the newest usable key wins, not the first one found", () => {
    // two keys, both usable. the one written last is the one in use,
    // because it is the one that replaced the other.
    const home = seed_store([
      {
        public_key: "ed25519:OLDER",
        method_names: [...SHIT_1170_CHESS_KEY_METHODS],
        allowance: SHIT_1170_CHESS_KEY_ALLOWANCE,
      },
    ]);

    // the newer record, written a moment later.
    add_record_fun(
      home,
      "ed25519:NEWER",
      [...SHIT_1170_CHESS_KEY_METHODS],
      SHIT_1170_CHESS_KEY_ALLOWANCE,
    );

    expect(signer_fun(home)).toBe("ed25519:NEWER");
  });
});
describe("the key the skill asks the human for", () => {
  test("the method list covers every method the skill calls", () => {
    // the matchmaking methods and create_ai_game are how a game is
    // found and opened. a key without them cannot do either.
    expect(SHIT_1170_CHESS_KEY_METHODS).toContain("play_move");
    expect(SHIT_1170_CHESS_KEY_METHODS).toContain("join_matchmaking");
    expect(SHIT_1170_CHESS_KEY_METHODS).toContain("cancel_matchmaking");
    expect(SHIT_1170_CHESS_KEY_METHODS).toContain("create_ai_game");
  });

  test("the method list leaves out the money-shaped methods", () => {
    expect(SHIT_1170_CHESS_KEY_METHODS).not.toContain("withdraw_token");
    expect(SHIT_1170_CHESS_KEY_METHODS).not.toContain("cancel_bet");
    expect(SHIT_1170_CHESS_KEY_METHODS).not.toContain("ft_transfer");
    expect(SHIT_1170_CHESS_KEY_METHODS).not.toContain("ft_transfer_call");
  });

  test("the allowance covers the prepaid gas of the largest call", () => {
    // mainnet's gas price is 1000000000 yoctoNEAR per gas unit, and
    // the largest gas this skill uses is 400 Tgas against a VeryHard
    // ai. the allowance must cover it.
    const GAS_PRICE = 1_000_000_000n;
    const largest = 400n * 1_000_000_000_000n * GAS_PRICE;
    expect(BigInt(SHIT_1170_CHESS_KEY_ALLOWANCE)).toBeGreaterThan(largest);
  });
});
