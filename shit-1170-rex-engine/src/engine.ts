import {
  api_shit_1170_api_key_me_get,
  api_shit_1170_swap_queue_get,
  api_shit_1170_swap_queue_one_get,
  api_shit_1170_swap_queue_post,
  api_shit_1170_tx_queue_get,
  api_shit_1170_tx_queue_one_get,
  api_shit_1170_tx_queue_post,
  quiet_fun,
  type SHIT_1170_SWAP_QUEUE_QUERY,
  type SHIT_1170_SWAP_QUEUE_REQUEST,
  type SHIT_1170_TX_QUEUE,
  type SHIT_1170_TX_QUEUE_QUERY,
  type SHIT_1170_TX_QUEUE_REQUEST,
} from "@huggies/shit-1170-rex-engine-middleman";
import { shit_1170_queue_record_put_fun } from "./local_queue";


export const SHIT_1170_DEFAULT_BASE_URL = "https://shit-1170.com";

export function shit_1170_base_url_fun(baseUrl?: string): string {
  return (baseUrl ?? SHIT_1170_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export async function shit_1170_queue_tx_fun(
  apiKey: string,
  body: SHIT_1170_TX_QUEUE_REQUEST,
  options: { baseUrl?: string } = {},
): Promise<{ queue: SHIT_1170_TX_QUEUE; localPath: string }> {
  const baseUrl = shit_1170_base_url_fun(options.baseUrl);
  const queue = await quiet_fun(() =>
    api_shit_1170_tx_queue_post(baseUrl, body, {
      api_key: apiKey,
    }),
  );
  const local = await shit_1170_queue_record_put_fun({
    kind: "tx",
    id: queue.queueId,
    request: body as unknown as Record<string, unknown>,
    response: queue as unknown as Record<string, unknown>,
  });
  return { queue, localPath: local.localPath };
}

export async function shit_1170_queue_swap_fun(
  apiKey: string,
  body: SHIT_1170_SWAP_QUEUE_REQUEST,
  options: { baseUrl?: string } = {},
): Promise<{ queue: Record<string, unknown>; localPath: string }> {
  const baseUrl = shit_1170_base_url_fun(options.baseUrl);
  const queue = await quiet_fun(() =>
    api_shit_1170_swap_queue_post(baseUrl, body, {
      api_key: apiKey,
    }),
  );
  const local = await shit_1170_queue_record_put_fun({
    kind: "swap",
    id: queue.swapId,
    request: body as unknown as Record<string, unknown>,
    response: queue as unknown as Record<string, unknown>,
  });
  return { queue: queue as unknown as Record<string, unknown>, localPath: local.localPath };
}

export async function shit_1170_tx_get_fun(
  queueId: string,
  options: { baseUrl?: string } = {},
): Promise<SHIT_1170_TX_QUEUE> {
  return quiet_fun(() =>
    api_shit_1170_tx_queue_one_get(
      shit_1170_base_url_fun(options.baseUrl),
      queueId,
    ),
  );
}

export async function shit_1170_swap_get_fun(
  swapId: string,
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await quiet_fun(() =>
    api_shit_1170_swap_queue_one_get(
      shit_1170_base_url_fun(options.baseUrl),
      swapId,
    ),
  );
  return result as unknown as Record<string, unknown>;
}

export async function shit_1170_tx_list_fun(
  query: SHIT_1170_TX_QUEUE_QUERY = {},
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await quiet_fun(() =>
    api_shit_1170_tx_queue_get(
      shit_1170_base_url_fun(options.baseUrl),
      query,
    ),
  );
  return result as unknown as Record<string, unknown>;
}

export async function shit_1170_swap_list_fun(
  query: SHIT_1170_SWAP_QUEUE_QUERY = {},
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await quiet_fun(() =>
    api_shit_1170_swap_queue_get(
      shit_1170_base_url_fun(options.baseUrl),
      query,
    ),
  );
  return result as unknown as Record<string, unknown>;
}

export async function shit_1170_api_key_me_fun(
  apiKey: string,
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await quiet_fun(() =>
    api_shit_1170_api_key_me_get(
      shit_1170_base_url_fun(options.baseUrl),
      { api_key: apiKey },
    ),
  );
  return result as unknown as Record<string, unknown>;
}

// --- THE HASHES, FROM THE SERVER ---
//
// the engine stores the hash of every send on the account row. so the
// human never has to hand the agent a hash: the agent reads it back
// out of the queue it queued.
//
// this is the shape the sent route wants:
//
//   { "txId": "<the transaction id>", "txHash": "<the hash>" }
//
// the tx id is on the transaction, and the hash is on the account row
// under that transaction. the two are matched by the tx id, because a
// batch can hold several transactions and each one can have its own
// hash.

/** one hash, ready for the sent route. */
export interface SHIT_1170_SERVER_HASH {
  txId: string;
  txHash: string;
}

function as_record_fun(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function read_string_fun(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * the hashes the server already has for one queued batch.
 *
 * the engine records the hash when the human's wallet reports the
 * send, so by the time the agent looks, the hash is there. the agent
 * reads it from the queue's own account rows.
 *
 * an empty array means the batch has not been sent yet — the account
 * rows have no hash on them.
 */
export async function shit_1170_tx_hashes_fun(
  queueId: string,
  options: { baseUrl?: string } = {},
): Promise<SHIT_1170_SERVER_HASH[]> {
  const queue = await shit_1170_tx_get_fun(queueId, options);
  const record = as_record_fun(queue);
  if (!record) return [];

  const out: SHIT_1170_SERVER_HASH[] = [];
  const seen = new Set<string>();

  // the transactions carry their own account rows, and each row that
  // has a hash is one send that happened.
  const transactions = record.transactions;
  if (Array.isArray(transactions)) {
    for (const transaction of transactions) {
      const transaction_record = as_record_fun(transaction);
      if (!transaction_record) continue;
      const txId = read_string_fun(transaction_record.txId);
      if (!txId) continue;
      const accounts = transaction_record.accounts;
      if (!Array.isArray(accounts)) continue;
      for (const account of accounts) {
        const account_record = as_record_fun(account);
        if (!account_record) continue;
        const txHash = read_string_fun(account_record.txHash);
        if (!txHash) continue;
        const key = `${txId}:${txHash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ txId, txHash });
      }
    }
  }

  return out;
}

/**
 * the hash of one queued swap, as the server has it.
 *
 * a swap is one transaction, so it has one hash.
 */
export async function shit_1170_swap_hash_fun(
  swapId: string,
  options: { baseUrl?: string } = {},
): Promise<string | null> {
  const swap = await shit_1170_swap_get_fun(swapId, options);
  const record = as_record_fun(swap);
  if (!record) return null;
  const accounts = record.accounts;
  if (!Array.isArray(accounts)) return null;
  for (const account of accounts) {
    const account_record = as_record_fun(account);
    if (!account_record) continue;
    const txHash = read_string_fun(account_record.txHash);
    if (txHash) return txHash;
  }
  return null;
}
