// sending a call, safely.
//
// --- WHY THIS EXISTS ---
// the rpc answers with HTTP 429 when it is rate-limited, and it
// sometimes does that AFTER the transaction has already gone through.
// the move is on the chain, and the answer that says so never arrived.
//
// that leaves the caller in a bad spot:
//
//   - treating it as a failure and retrying sends the SAME MOVE TWICE.
//     a move played twice is a move the contract refuses, and a
//     refused move is a failed transaction that still costs gas.
//   - treating it as a success leaves the caller not knowing whether
//     the move happened.
//
// so a failed send is not proof that the move did not land. the only
// way to know is to LOOK: read the game again and see whether the
// position moved on.
//
// --- HOW IT WORKS ---
// the send is attempted. if it throws, the caller is asked whether the
// position changed. if it did, the move landed and the answer is
// reported as a success with the hash left empty. if it did not, the
// send is retried, with a wait between the attempts.
//
// the checker is supplied by the caller, because only the caller knows
// what "the position moved on" means for the call it made.

/**
 * how a caller says whether a call landed.
 *
 * it is given the position BEFORE the call and is asked about the
 * position after it. it returns true when the call is visible on the
 * chain.
 */
export type SHIT_1170_CHESS_LANDED_CHECK = (
  before: unknown,
) => Promise<boolean>;

/**
 * send a call, and find out whether it landed.
 *
 * the return is the same shape as the plain send, with one addition:
 * `landed_without_answer` is true when the call went through but the
 * rpc never said so. the transaction hash is empty in that case,
 * because there was no answer to read it from.
 */
export async function shit_1170_chess_send_safe_fun(
  send: () => Promise<{ tx_hash: string; outcome: unknown }>,
  read_before: () => Promise<unknown>,
  landed: SHIT_1170_CHESS_LANDED_CHECK,
  attempts = 4,
  wait_ms = 5000,
): Promise<{
  tx_hash: string;
  outcome: unknown;
  landed_without_answer: boolean;
}> {
  let before: unknown;
  try {
    before = await read_before();
  } catch {
    // the position could not be read. that is not a reason to refuse
    // the send — it just means there is nothing to compare against.
    before = undefined;
  }

  let last_error: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const sent = await send();
      return { ...sent, landed_without_answer: false };
    } catch (error) {
      last_error = error;

      // did the call land anyway?
      if (before !== undefined) {
        try {
          if (await landed(before)) {
            // it landed. the answer was lost, not the move.
            return {
              tx_hash: "",
              outcome: null,
              landed_without_answer: true,
            };
          }
        } catch {
          // the check itself failed. fall through to the retry.
        }
      }

      if (attempt < attempts - 1) {
        await sleep_fun(wait_ms * (attempt + 1));
      }
    }
  }

  throw last_error instanceof Error
    ? last_error
    : new Error(String(last_error));
}

/**
 * wait, without blocking anything else.
 */
function sleep_fun(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
