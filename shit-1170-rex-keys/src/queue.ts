import {
  api_shit_1170_tx_queue_post,
  quiet_fun,
  type SHIT_1170_TX_QUEUE,
  type SHIT_1170_TX_QUEUE_TRANSACTION_REQUEST,
} from "@huggies/shit-1170-rex-engine-middleman";

// queueing a KEY ACTION.
//
// --- WHY A KEY ACTION IS NOT A CONTRACT CALL ---
// the tx queue carries two kinds of transaction. one is a contract call
// — a contract, a method, some arguments. the other is a KEY ACTION —
// `add_key` or `delete_key` — which names a public key and, for an
// addition, what that key may call.
//
// a key action has NO contract and NO method. the backend refuses a
// transaction that claims to be both, so the fields are sent empty and
// the key fields carry the transaction.
//
// --- WHY THE ALLOWANCE IS A STRING ---
// an allowance is in yoctoNEAR. a NEAR amount is 24 decimals, so the
// number is far past the safe range of a JavaScript number, and a JSON
// number would silently lose the low digits. the wire carries it as a
// string and it is sent as a string.
//
// --- WHY NO GAS AND NO DEPOSIT ---
// an `AddKey` action costs no deposit and its gas is the network's
// default. the backend stores them as null and the wallet signs what
// the action says.

export const SHIT_1170_KEY_ACTION_ADD = "add_key";
export const SHIT_1170_KEY_ACTION_REMOVE = "delete_key";

export const SHIT_1170_DEFAULT_BASE_URL = "https://shit-1170.com";

export interface SHIT_1170_KEY_ACTION_INPUT {
  /** `add_key` or `delete_key`. */
  action: string;
  /** `ed25519:...` — the key the action is about. */
  public_key: string;
  /** the contract the key may call. required for an addition. */
  receiver_id?: string | null;
  /** the methods the key may call. empty means every method. */
  method_names?: string[];
  /**
   * the gas budget in yoctoNEAR. required for an addition.
   *
   * every key this skill queues carries a real number. the protocol
   * would read an absent allowance as unlimited gas and a zero as a key
   * that cannot make a call, and this skill refuses both.
   */
  allowance?: string | null;
}

/**
 * build the transaction for a key action.
 *
 * the contract id and the method are empty strings, because a key
 * action is not a call and the backend refuses a transaction that says
 * otherwise.
 */
export function shit_1170_key_action_transaction_fun(
  input: SHIT_1170_KEY_ACTION_INPUT,
): SHIT_1170_TX_QUEUE_TRANSACTION_REQUEST {
  const action = input.action.trim();
  if (action !== SHIT_1170_KEY_ACTION_ADD && action !== SHIT_1170_KEY_ACTION_REMOVE) {
    throw new Error(
      `the action must be ${SHIT_1170_KEY_ACTION_ADD} or ${SHIT_1170_KEY_ACTION_REMOVE}, got "${action}"`,
    );
  }

  const publicKey = input.public_key.trim();
  if (!publicKey) throw new Error("the public key is required");

  const transaction: SHIT_1170_TX_QUEUE_TRANSACTION_REQUEST = {
    contractId: "",
    method: "",
    keyAction: action,
    keyPublicKey: publicKey,
  };

  if (action === SHIT_1170_KEY_ACTION_ADD) {
    const receiverId = input.receiver_id?.trim() ?? "";
    if (!receiverId) {
      throw new Error(
        "an add_key must name the receiver id — the contract the key may call",
      );
    }
    transaction.keyReceiverId = receiverId;
    transaction.keyMethodNames = input.method_names ?? [];
    // --- WHY THE ALLOWANCE IS REQUIRED HERE: a limited key always needs
    // gas to make a call. the protocol reads a missing allowance as
    // unlimited gas and a zero allowance as a key that cannot make a
    // call, and the bin refuses both before it gets here. so the field
    // is always sent, and it is always a real number.
    const allowance = input.allowance?.trim();
    if (allowance === undefined || allowance.length === 0) {
      throw new Error(
        "an add_key must name an allowance: it is the key's gas budget, and a key always needs gas to make a call",
      );
    }
    transaction.keyAllowance = allowance;
  }

  return transaction;
}

export interface SHIT_1170_KEY_QUEUED {
  queue: SHIT_1170_TX_QUEUE;
  queue_id: string;
  tx_id: string | null;
}

/**
 * queue a key action for an account.
 *
 * the WHO list names the account the batch is for. an account that is
 * not the caller's own must be one the caller holds an api key for, or
 * the backend refuses the batch.
 */
export async function shit_1170_key_queue_fun(
  apiKey: string,
  transaction: SHIT_1170_TX_QUEUE_TRANSACTION_REQUEST,
  options: {
    baseUrl?: string;
    accountId?: string;
    what?: string;
    when?: string;
    why?: string;
  } = {},
): Promise<SHIT_1170_KEY_QUEUED> {
  const baseUrl = (options.baseUrl ?? SHIT_1170_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );

  const body = {
    what:
      options.what ??
      `ADD A LIMITED ACCESS KEY ${transaction.keyPublicKey ?? ""}`.trim(),
    ...(options.when === undefined ? {} : { when: options.when }),
    ...(options.why === undefined ? {} : { why: options.why }),
    transactions: [transaction],
    ...(options.accountId === undefined
      ? {}
      : { accounts: [options.accountId] }),
  };

  const queue = await quiet_fun(() =>
    api_shit_1170_tx_queue_post(baseUrl, body, { api_key: apiKey }),
  );

  const transactions = (queue as { transactions?: unknown }).transactions;
  const first = Array.isArray(transactions) ? transactions[0] : null;
  const txId =
    first && typeof first === "object" && first !== null
      ? (first as { txId?: unknown }).txId
      : null;

  return {
    queue,
    queue_id: queue.queueId,
    tx_id: typeof txId === "string" ? txId : null,
  };
}
