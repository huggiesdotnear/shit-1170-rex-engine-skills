import { homedir } from "node:os";
import { join } from "node:path";

// where this skill keeps its files.
//
// --- WHY THE SAME HOME AS THE ENGINE SKILL ---
// the engine skill owns the queueing mechanics and writes its local
// copy of every queued batch under `${HOME}/.shit-1170-rex-engine/queue/`.
// this skill's files belong to the same family, so they live in the same
// folder, under their own `keys/` subfolder. one home, one place to look,
// one `SHIT_1170_REX_HOME` override for all of it.
//
// --- WHY A `keys/` SUBFOLDER AND NOT FILES AT THE ROOT ---
// the root already holds `accounts/`, `queue/`, `tx/` and `irc/`, each
// owned by a different skill. a `keys/` folder keeps this skill's
// files together and lets the engine skill add folders of its own
// without a naming argument.
//
// --- WHY THE STORE IS UNDER HOME AND NOT UNDER THE REPO ---
// the store holds PRIVATE KEYS AND SEED PHRASES. a repo gets committed,
// a repo gets cloned, and a repo gets copied into a backup. a folder in
// the home directory does not.

export const SHIT_1170_HOME_DIR_NAME = ".shit-1170-rex-engine";

export function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), SHIT_1170_HOME_DIR_NAME);
}

/**
 * the folder this skill owns: `${HOME}/.shit-1170-rex-engine/keys/`.
 */
export function shit_1170_keys_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "keys");
}

/**
 * the sqlite file that holds every key pair this agent generated.
 *
 * it sits beside the `added/` folder rather than inside it, because it
 * is a different kind of record: the sqlite holds EVERY key that was
 * ever generated, and the json files hold only the ones that were
 * actually offered to an account.
 */
export function shit_1170_keys_db_path_fun(): string {
  return join(shit_1170_keys_dir_fun(), "keys.sqlite");
}

/**
 * the folder holding one json file per key that was queued for an account.
 */
export function shit_1170_keys_added_dir_fun(): string {
  return join(shit_1170_keys_dir_fun(), "added");
}

/**
 * the json file for one queued key.
 *
 * the name is the public key with the characters a filesystem does not
 * like replaced. a public key looks like `ed25519:7Zq...`, so the colon
 * becomes an underscore and the file reads as
 * `ed25519_7Zq....json`.
 */
export function shit_1170_keys_added_path_fun(public_key: string): string {
  const safe = public_key.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe) throw new Error("public key is required");
  return join(shit_1170_keys_added_dir_fun(), `${safe}.json`);
}
