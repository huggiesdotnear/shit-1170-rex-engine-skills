import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { shit_1170_keys_added_dir_fun, shit_1170_keys_added_path_fun } from "./paths";
import type { SHIT_1170_KEY_ADDED } from "./types";

// the json files that record the keys this agent offered to accounts.
//
// --- WHY A JSON FILE PER KEY AND NOT A ROW IN THE SQLITE ---
// the two stores hold different things and answer different questions.
//
// the sqlite holds the SECRET: the private key and the seed phrase of
// every key ever generated, whatever happened to it afterwards.
//
// the json file holds the DEAL: which account the key was offered to,
// which contract it may call, which methods, which allowance, and
// which queue it went out in.
//
// a key that was generated and never offered is in the sqlite and in no
// json file. a key that was offered is in both, and the json file
// names the sqlite row. so the key is saved twice, and the two copies
// cannot disagree about WHICH key it is, because the json file carries
// the public key.
//
// --- WHY THE JSON FILES DO NOT HOLD THE SECRET ---
// a json file is the easy one to copy, to sync, to paste into a bug
// report. the private key and the seed phrase stay in the sqlite file,
// which is 0600 and is one file. the details are in the json file
// because the details are not a secret — and because the details are
// what a reader needs to see.
//
// --- WHY 0600 ANYWAY ---
// the public key and the allowance are not a secret, but the file
// names a key that the agent can sign with. a file that says "this
// machine holds the key to this account" is worth keeping to the
// account's owner only.

/**
 * write the record of one offered key.
 *
 * the write replaces an existing file for the same public key, so a key
 * that was offered twice ends up with one record — the latest one.
 */
export async function shit_1170_keys_added_put_fun(
  key: SHIT_1170_KEY_ADDED,
): Promise<string> {
  const path = shit_1170_keys_added_path_fun(key.public_key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(key, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return path;
}

/**
 * the record of one offered key, or null when there is none.
 */
export async function shit_1170_keys_added_get_fun(
  public_key: string,
): Promise<SHIT_1170_KEY_ADDED | null> {
  const path = shit_1170_keys_added_path_fun(public_key);
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as SHIT_1170_KEY_ADDED;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * every offered key, newest first.
 */
export async function shit_1170_keys_added_list_fun(): Promise<
  Array<SHIT_1170_KEY_ADDED & { local_path: string }>
> {
  const directory = shit_1170_keys_added_dir_fun();
  const { readdir } = await import("node:fs/promises");
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Array<SHIT_1170_KEY_ADDED & { local_path: string }> = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    const path = `${directory}/${name}`;
    try {
      const text = await readFile(path, "utf8");
      const record = JSON.parse(text) as SHIT_1170_KEY_ADDED;
      out.push({ ...record, local_path: path });
    } catch {
      // a file that cannot be read is skipped rather than fatal: the
      // listing is a report, and one broken file must not hide the
      // rest of the records.
      continue;
    }
  }
  return out.sort((a, b) => b.created_at - a.created_at);
}

/**
 * the records of the keys offered to one account.
 */
export async function shit_1170_keys_added_for_account_fun(
  account_id: string,
): Promise<Array<SHIT_1170_KEY_ADDED & { local_path: string }>> {
  const all = await shit_1170_keys_added_list_fun();
  return all.filter((record) => record.account_id === account_id);
}
