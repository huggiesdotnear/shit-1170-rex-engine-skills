// the local account list, read only.
//
// --- WHY THIS IS HERE ---
// the engine skill owns the keyring — one file per account, each
// holding an API key. this skill does NOT need the key: it needs the
// account id, so a bin can pick the signing account for a read that
// wants one (the wrap's storage check reads the account's
// registration on wrap.near).
//
// so this reads the ids and nothing else. it never reads, logs, or
// prints a key.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { shit_1170_accounts_dir_fun } from "./paths";

/**
 * the account ids the engine holds a key for.
 *
 * the file name is the account id, with the characters an account id
 * cannot hold replaced. so the ids are read back from the files
 * themselves, not guessed back from their names — a name like
 * `sleet_near.json` is not a NEAR account id.
 */
export async function shit_1170_stored_account_ids_fun(): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(shit_1170_accounts_dir_fun());
  } catch {
    return [];
  }

  const ids: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -".json".length);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * the one account to read for, when nobody said which.
 *
 * more than one account is an ambiguity the caller has to resolve:
 * guessing would read the wrong account's balances.
 */
export async function shit_1170_default_account_fun(): Promise<string | null> {
  const ids = await shit_1170_stored_account_ids_fun();
  if (ids.length === 1) return ids[0] ?? null;
  return null;
}
