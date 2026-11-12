// signing with the limited access key.
//
// --- THIS IS THE EXCEPTION TO THE LIBRARY'S ONE RULE ---
// every other skill in this library says the same thing: the agent
// NEVER signs, the human signs in the web app. that rule is what
// makes an agent safe to point at a stranger's message.
//
// AUTONOMOUS MODE BREAKS THAT RULE, ON PURPOSE, AND ONLY HERE.
//
// the break is bounded by three things:
//
//   1. the key is a LIMITED access key. it names one receiver — the
//      chess contract — and it cannot sign for the account itself, so
//      it cannot move the account's NEAR, cannot create accounts and
//      cannot add or delete keys.
//   2. the key is CHOSEN BY A HUMAN. it is queued for approval like
//      every other write, and the human signs the `add_key`.
//   3. the set of methods it may call is checked before it is used.
//
// --- WHY THE KEY IS FOUND IN THE KEYS SKILL'S STORE ---
// the keys skill owns the keys. its sqlite holds every key pair the
// agent ever generated, and its `key_list.ts` is deliberately
// secret-free — a listing is a thing an agent reads and then repeats
// in a conversation, and a secret that is read is a secret that is
// copied.
//
// so the private key is read from the sqlite DIRECTLY, with a narrow
// query: the one key whose receiver is the chess contract.
//
// --- WHY A FULL ACCESS KEY IS REFUSED ---
// a full access key IS the account. it would work here, and that is
// exactly why it must be refused: the limited key is the whole reason
// autonomous mode is bounded. a full access key would let the agent
// move the money, and no amount of care in this file would stop that.

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Near } from "near-kit";

import { SHIT_1170_CHESS_CONTRACT_ID } from "./chain";
import {
  SHIT_1170_CHESS_KEY_ALLOWANCE,
  SHIT_1170_CHESS_KEY_METHODS,
} from "./payload";
import type { SHIT_1170_CHESS_QUEUE_CALL } from "./types";

// --- WHERE THE KEYS SKILL'S STORE IS ---
//
// the path is built here rather than imported, because the chess skill
// does not depend on the keys skill's package — it only reads the same
// files. one home, one `SHIT_1170_REX_HOME` override for all of it.

function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), ".shit-1170-rex-engine");
}

/** the sqlite that holds every key pair the agent generated. */
function shit_1170_keys_db_path_fun(): string {
  return join(shit_1170_home_dir_fun(), "keys", "keys.sqlite");
}

/** the folder holding one json file per offered key. */
function shit_1170_keys_added_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "keys", "added");
}

/**
 * a key the agent holds, and what it may call.
 */
export interface SHIT_1170_CHESS_SIGNER {
  /** the account the key signs for. */
  account_id: string;
  /** `ed25519:...` — the public key. */
  public_key: string;
  /** `ed25519:...` — the private key. never printed. */
  secret_key: string;
  /** the contract the key may call. */
  receiver_id: string;
  /** the methods it may call there. empty means every method. */
  method_names: string[];
}

/**
 * the key is not usable for what this skill does.
 */
export class SHIT_1170_CHESS_SIGNER_ERROR extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SHIT_1170_CHESS_SIGNER_ERROR";
  }
}

/**
 * the private keys the agent holds, by public key.
 *
 * the query is narrow on purpose: the agent does not go rummaging in
 * the store for whatever key is convenient. it is given the public
 * keys it is looking for, and it answers with those it holds.
 */
export function shit_1170_chess_held_secrets_fun(
  public_keys: string[],
): Map<string, string> {
  const found = new Map<string, string>();
  if (public_keys.length === 0) return found;

  const path = shit_1170_keys_db_path_fun();

  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch (error) {
    throw new SHIT_1170_CHESS_SIGNER_ERROR(
      `the key store is not readable at ${path}. the keys skill owns it — ` +
        `generate a key with it and queue the addition. (${
          error instanceof Error ? error.message : String(error)
        })`,
    );
  }

  try {
    const placeholders = public_keys.map(() => "?").join(", ");
    const rows = db
      .query(
        `SELECT public_key, secret_key FROM keys
         WHERE public_key IN (${placeholders});`,
      )
      .all(...public_keys) as { public_key: string; secret_key: string }[];

    for (const row of rows) found.set(row.public_key, row.secret_key);
  } finally {
    db.close();
  }

  return found;
}

/**
 * read the details of the keys that were offered to an account.
 *
 * the details live in one json file per offered key, under the keys
 * skill's `added/` folder. the file is named after the public key, and
 * it holds the DEAL — the account, the receiver, the methods and the
 * allowance — but never the secret.
 */
export function shit_1170_chess_key_details_fun(
  account_id: string,
): {
  public_key: string;
  receiver_id: string | null;
  method_names: string[];
  allowance: string | null;
  action: string | null;
  offered_at: number;
}[] {
  const added_dir = shit_1170_keys_added_dir_fun();

  let files: string[];
  try {
    files = readdirSync(added_dir);
  } catch {
    // no store, no keys. that is an answer, not a crash.
    return [];
  }

  const details: {
    public_key: string;
    receiver_id: string | null;
    method_names: string[];
    allowance: string | null;
    action: string | null;
    offered_at: number;
  }[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const path = join(added_dir, file);
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        public_key?: string;
        account_id?: string;
        receiver_id?: string | null;
        method_names?: string[];
        allowance?: string | null;
        action?: string | null;
      };
      if (parsed.account_id !== account_id) continue;
      details.push({
        public_key: parsed.public_key ?? "",
        receiver_id: parsed.receiver_id ?? null,
        method_names: parsed.method_names ?? [],
        allowance: parsed.allowance ?? null,
        action: parsed.action ?? null,
        offered_at: statSync(path).mtimeMs,
      });
    } catch {
      // a file that cannot be read is not a reason to refuse the rest.
      continue;
    }
  }

  return details;
}

/**
 * find the key the agent may sign chess calls with.
 *
 * the key must be:
 *   - held by the agent (its private key is in the store)
 *   - offered to THIS account
 *   - scoped to the chess contract
 *   - still on the account (a key that was removed is not a key)
 *
 * a key with a method list that does not include `play_move` cannot
 * play, so it is not the key for this skill.
 *
 * --- WHICH KEY, WHEN THERE ARE SEVERAL ---
 * the newest usable one wins. an account accumulates keys over time,
 * and an older key that was replaced is still in the store. the
 * records are ordered by when they were written, so the most recently
 * offered key is the one that is tried first — and the older ones are
 * the fallback, not the first choice.
 */
export function shit_1170_chess_signer_find_fun(
  account_id: string,
): SHIT_1170_CHESS_SIGNER {
  const details = shit_1170_chess_key_details_fun(account_id);
  const all_chess = details.filter(
    (detail) => detail.receiver_id === SHIT_1170_CHESS_CONTRACT_ID,
  );
  const saw_removed =
    all_chess.length > 0 &&
    all_chess.every((detail) => detail.action === "delete_key");
  const chess_details = all_chess
    .filter((detail) => detail.action !== "delete_key")
    // newest first: the key offered most recently is the one in use.
    // the order is the file's mtime, NOT the order the directory
    // happens to be read in — that is not the same thing, and it is
    // not guaranteed.
    .sort((a, b) => b.offered_at - a.offered_at);

  if (chess_details.length === 0) {
    // every key this account had was taken back off it.
    if (saw_removed) {
      throw new SHIT_1170_CHESS_SIGNER_ERROR(
        `the key for ${SHIT_1170_CHESS_CONTRACT_ID} was offered to ${account_id} ` +
          `and then removed from it. the human signs a new one — the keys skill ` +
          `queues it with key_queue_add.ts --receiver-id ${SHIT_1170_CHESS_CONTRACT_ID}.`,
      );
    }

    throw new SHIT_1170_CHESS_SIGNER_ERROR(
      `no key for ${SHIT_1170_CHESS_CONTRACT_ID} was offered to ${account_id}. ` +
        `the human signs the add_key — the keys skill queues it with ` +
        `key_queue_add.ts --receiver-id ${SHIT_1170_CHESS_CONTRACT_ID}.`,
    );
  }

  const secrets = shit_1170_chess_held_secrets_fun(
    chess_details.map((detail) => detail.public_key),
  );

  let saw_wrong_methods = false;
  let saw_no_allowance = false;

  for (const detail of chess_details) {
    const secret = secrets.get(detail.public_key);
    if (!secret) continue;

    if (
      detail.method_names.length > 0 &&
      !detail.method_names.includes("play_move")
    ) {
      saw_wrong_methods = true;
      continue;
    }

    // the allowance covers the PREPAID GAS, not the deposit. a key
    // with an allowance of 0 cannot make any call: the contract
    // refuses it with NotEnoughAllowance before the call runs.
    if (detail.allowance !== null && BigInt(detail.allowance) === 0n) {
      saw_no_allowance = true;
      continue;
    }

    return {
      account_id,
      public_key: detail.public_key,
      secret_key: secret,
      receiver_id: SHIT_1170_CHESS_CONTRACT_ID,
      method_names: detail.method_names,
    };
  }

  // the key cannot call the methods the skill needs.
  if (saw_wrong_methods) {
    throw new SHIT_1170_CHESS_SIGNER_ERROR(
      `the key for ${SHIT_1170_CHESS_CONTRACT_ID} was offered to ${account_id} ` +
        `without the methods this skill calls. a key that cannot call ` +
        `play_move cannot play. the human signs a key with the full list — ` +
        `the keys skill queues it with key_queue_add.ts --receiver-id ` +
        `${SHIT_1170_CHESS_CONTRACT_ID} --methods ` +
        `${SHIT_1170_CHESS_KEY_METHODS.join(",")} --allowance ` +
        `${SHIT_1170_CHESS_KEY_ALLOWANCE}.`,
    );
  }

  // the key cannot cover the prepaid gas.
  if (saw_no_allowance) {
    throw new SHIT_1170_CHESS_SIGNER_ERROR(
      `the key for ${SHIT_1170_CHESS_CONTRACT_ID} was offered to ${account_id} ` +
        `with an allowance of 0. the allowance covers the PREPAID GAS, not the ` +
        `deposit — a 30 Tgas call needs 0.03 NEAR of it. the human signs a key ` +
        `with a real allowance — the keys skill queues it with ` +
        `key_queue_add.ts --receiver-id ${SHIT_1170_CHESS_CONTRACT_ID} ` +
        `--allowance ${SHIT_1170_CHESS_KEY_ALLOWANCE}.`,
    );
  }

  throw new SHIT_1170_CHESS_SIGNER_ERROR(
    `the key for ${SHIT_1170_CHESS_CONTRACT_ID} was offered to ${account_id}, ` +
      `but the agent does not hold its private key. the human hands the key ` +
      `to the agent, or the agent generates one with the keys skill.`,
  );
}

/**
 * a NEAR client that SIGNS with the limited key.
 *
 * this is the only client in the skill that has a signer. every other
 * read goes through the read-only client in `chain.ts`.
 *
 * the key is given to near-kit as a `privateKey` with a
 * `defaultSignerId`, which puts it in the key store under the account
 * it signs for. a `signer` config would be the alternative, but the
 * keyStore route is the one near-kit uses for key-based operations, so
 * the nonce handling and the key lookup are the ones it expects.
 */
export function shit_1170_chess_signing_client_fun(
  signer: SHIT_1170_CHESS_SIGNER,
  network: "mainnet" | "testnet" = "mainnet",
): Near {
  return new Near({
    network,
    privateKey: signer.secret_key as `ed25519:${string}`,
    defaultSignerId: signer.account_id,
  });
}

/**
 * sign and send one call.
 *
 * the call is a queue payload, so the same shape drives both modes:
 * in propose mode the payload goes to the engine's queue, and in
 * autonomous mode it is signed here.
 *
 * --- THE UNITS ARE CONVERTED HERE ---
 * the queue payload holds RAW DIGIT STRINGS, because that is what the
 * engine's queue accepts — `"150000000000000"` for the gas and `"0"`
 * for the deposit. near-kit wants the same values with their UNITS:
 * `"150 Tgas"` and `"0 yocto"`.
 *
 * so the raw strings are turned into near-kit's forms here. the
 * conversion is exact: a gas digit string divided by 1e12 is a whole
 * number of Tgas, because every gas figure this skill uses is a
 * whole number of Tgas.
 */
export async function shit_1170_chess_send_fun(
  signer: SHIT_1170_CHESS_SIGNER,
  call: SHIT_1170_CHESS_QUEUE_CALL,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<{ tx_hash: string; outcome: unknown }> {
  const near = shit_1170_chess_signing_client_fun(signer, network);

  const result = await near.call(
    call.contractId,
    call.method,
    call.args,
    {
      gas: raw_gas_to_near_kit_fun(call.gas),
      attachedDeposit: raw_deposit_to_near_kit_fun(call.deposit),
    },
  );

  return { tx_hash: result.transaction?.hash ?? "", outcome: result };
}

/**
 * a raw gas digit string as near-kit's gas form.
 *
 * the raw string is a whole number of gas units, and the skill's gas
 * figures are whole numbers of Tgas, so the division is exact.
 */
export function raw_gas_to_near_kit_fun(raw: string): `${number} Tgas` {
  const units = BigInt(raw);
  const tgas = units / 1_000_000_000_000n;
  return `${tgas} Tgas` as `${number} Tgas`;
}

/**
 * a raw yoctoNEAR digit string as near-kit's amount form.
 */
export function raw_deposit_to_near_kit_fun(raw: string): `${bigint} yocto` {
  return `${BigInt(raw)} yocto` as `${bigint} yocto`;
}
