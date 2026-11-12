import { Near } from "near-kit";

import type { SHIT_1170_KEY_ON_CHAIN } from "./types";

// reading the access keys an account has.
//
// --- WHY A READ AND NOT A QUEUE ---
// a view is a read. it needs no API key, no engine account, and no
// signature, and it changes nothing. the agent reads the keys here and
// the engine's queue is for the WRITES.
//
// --- WHY THE PERMISSION IS READ BY ITS SHAPE ---
// the chain answers with a permission that is one of four things:
// `FullAccess`, `FunctionCall`, `GasKeyFunctionCall`, or
// `GasKeyFullAccess`. a full access key IS the account — removing one
// locks the holder out, and the backend refuses to queue that. so the
// read says plainly which of the four it found.
//
// --- WHY A GAS KEY IS TREATED AS A LIMITED KEY ---
// a gas key is a funded key with its own nonce slots. it is still
// limited to a receiver and a set of methods, so it is still safe to
// hold and to remove. the backend treats it the same way.

export type SHIT_1170_KEY_NETWORK = "mainnet" | "testnet";

/**
 * a read-only NEAR client for one network.
 *
 * the client has no signer and no private key, so it can only answer
 * views.
 */
export function shit_1170_key_near_client_fun(
  network: SHIT_1170_KEY_NETWORK = "mainnet",
): Near {
  return new Near({ network });
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * the access key's own fields, read off an unknown record.
 *
 * the chain's answer is typed, but it is parsed defensively here: a
 * permission shape this code has not seen is not a crash, it is a key
 * whose details are unknown.
 */
function access_key_fields_fun(value: unknown): {
  nonce: number;
  permission: unknown;
} {
  if (!is_record(value)) return { nonce: 0, permission: null };
  const nonce = value["nonce"];
  return {
    nonce: typeof nonce === "number" ? nonce : 0,
    permission: value["permission"] ?? null,
  };
}

function read_string(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function read_method_names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((one): one is string => typeof one === "string");
}

/**
 * the access keys of one account, read off the chain.
 *
 * `held_public_keys` is the set of keys this agent holds the private
 * key for. a key in that set is marked `held_locally`, so a reader can
 * tell at a glance which of the account's keys the agent could sign
 * with — and which ones it could not.
 */
export async function shit_1170_key_chain_list_fun(
  account_id: string,
  options: {
    network?: SHIT_1170_KEY_NETWORK;
    held_public_keys?: Set<string>;
  } = {},
): Promise<{
  account_id: string;
  network: SHIT_1170_KEY_NETWORK;
  block_height: number;
  keys: SHIT_1170_KEY_ON_CHAIN[];
}> {
  const account = account_id.trim();
  if (!account) throw new Error("account id is required");

  const network = options.network ?? "mainnet";
  const held = options.held_public_keys ?? new Set<string>();
  const client = shit_1170_key_near_client_fun(network);

  const response = await client.getAccessKeys(account);

  const keys: SHIT_1170_KEY_ON_CHAIN[] = [];
  for (const entry of response.keys ?? []) {
    if (!is_record(entry)) continue;
    const publicKey = read_string(entry.public_key);
    if (!publicKey) continue;

    const accessKey = access_key_fields_fun(entry.access_key);
    const nonce = accessKey.nonce;

    let fullAccess = false;
    let receiverId: string | null = null;
    let methodNames: string[] = [];
    let allowance: string | null = null;

    const permission = accessKey.permission;

    // --- WHY THE FOUR CASES ARE NAMED OUT: the chain's permission is
    // a union of four shapes, and reading it by its shape is the only
    // way to know which one it is. the two full-access shapes carry no
    // receiver at all.
    if (permission === "FullAccess") {
      fullAccess = true;
    } else if (is_record(permission)) {
      const functionCall = is_record(permission.FunctionCall)
        ? permission.FunctionCall
        : null;
      const gasKeyFunctionCall = is_record(permission.GasKeyFunctionCall)
        ? permission.GasKeyFunctionCall
        : null;

      if (functionCall) {
        receiverId = read_string(functionCall.receiver_id);
        methodNames = read_method_names(functionCall.method_names);
        allowance = read_string(functionCall.allowance);
      } else if (gasKeyFunctionCall) {
        receiverId = read_string(gasKeyFunctionCall.receiver_id);
        methodNames = read_method_names(gasKeyFunctionCall.method_names);
        allowance = read_string(gasKeyFunctionCall.allowance);
      } else if (permission.GasKeyFullAccess !== undefined) {
        fullAccess = true;
      }
    }

    keys.push({
      public_key: publicKey,
      full_access: fullAccess,
      receiver_id: receiverId,
      method_names: methodNames,
      allowance: allowance,
      nonce,
      held_locally: held.has(publicKey),
    });
  }

  return {
    account_id: account,
    network,
    block_height: response.block_height ?? 0,
    keys,
  };
}
