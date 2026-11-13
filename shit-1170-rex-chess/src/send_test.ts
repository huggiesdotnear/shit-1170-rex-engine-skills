// the safe send, tested against the two failures it exists for.
//
// --- WHY THIS FILE EXISTS ---
// the rpc answers with HTTP 429 when it is rate-limited, and it
// sometimes does that AFTER the transaction has already gone through.
//
// so a failed send is not proof that the move did not land. the safe
// send looks at the chain to find out, and it does NOT send the same
// move twice.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";

import { shit_1170_chess_send_safe_fun } from "./send";

describe("the safe send", () => {
  test("a call that succeeds is reported as a success", async () => {
    const sent = await shit_1170_chess_send_safe_fun(
      async () => ({ tx_hash: "abc", outcome: { ok: true } }),
      async () => "position-before",
      async () => false,
    );

    expect(sent.tx_hash).toBe("abc");
    expect(sent.landed_without_answer).toBe(false);
  });

  test("a call that fails and did NOT land is retried", async () => {
    let calls = 0;
    const sent = await shit_1170_chess_send_safe_fun(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("HTTP 429: Too Many Requests");
        return { tx_hash: "xyz", outcome: null };
      },
      async () => "position-before",
      async () => false,
      4,
      1,
    );

    expect(calls).toBe(3);
    expect(sent.tx_hash).toBe("xyz");
    expect(sent.landed_without_answer).toBe(false);
  });

  test("a call that fails but DID land is not sent again", async () => {
    let calls = 0;
    const sent = await shit_1170_chess_send_safe_fun(
      async () => {
        calls += 1;
        // the transaction went through, and the answer was lost.
        throw new Error("HTTP 429: Too Many Requests");
      },
      async () => "position-before",
      async () => true, // the position moved on: it landed
      4,
      1,
    );

    // one call only — sending it again would play the move twice.
    expect(calls).toBe(1);
    expect(sent.landed_without_answer).toBe(true);
    expect(sent.tx_hash).toBe("");
  });

  test("a call that keeps failing is given up on", async () => {
    let calls = 0;
    let thrown = "";

    try {
      await shit_1170_chess_send_safe_fun(
        async () => {
          calls += 1;
          throw new Error("the contract refused it");
        },
        async () => "position-before",
        async () => false,
        3,
        1,
      );
    } catch (error) {
      thrown = (error as Error).message;
    }

    expect(calls).toBe(3);
    expect(thrown).toContain("the contract refused it");
  });

  test("a position that cannot be read does not stop the send", async () => {
    let calls = 0;
    const sent = await shit_1170_chess_send_safe_fun(
      async () => {
        calls += 1;
        return { tx_hash: "first", outcome: null };
      },
      async () => {
        throw new Error("the chain is not answering");
      },
      async () => false,
    );

    expect(sent.tx_hash).toBe("first");
    expect(calls).toBe(1);
  });
});
