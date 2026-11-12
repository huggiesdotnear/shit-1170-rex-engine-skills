import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// the engine's API KEYRING, read from the store the engine skill writes.
//
// --- WHY THIS SKILL READS THE ENGINE'S KEYRING ---
// queueing needs the engine's API key, and the engine's api key lives
// in the engine's own store: one private file per account under
// `${HOME}/.shit-1170-rex-engine/accounts/`. that is where the engine
// skill's `keyring.ts` puts it, and this skill reads the same files.
//
// the skill does NOT take an api key on the command line. a key on the
// command line lands in the shell history and in the process list, and
// the keyring file is 0600 for a reason.
//
// --- WHY THE FILES ARE READ DIRECTLY ---
// the engine skill is a separate package and this skill does not depend
// on it. reading six lines of json out of a known folder is cheaper
// than taking a dependency on another skill's internals, and the
// folder's shape is documented in the skills README.

export interface SHIT_1170_KEY_ACCOUNT_PROFILE {
  accountId: string;
  apiKey: string;
  baseUrl?: string;
  label?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * the folder the engine skill keeps the api keys in.
 */
function accounts_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  const home = from_env
    ? from_env
    : join(homedir(), ".shit-1170-rex-engine");
  return join(home, "accounts");
}

/**
 * every stored account, WITHOUT the api key.
 */
async function account_list_fun(): Promise<
  Array<Omit<SHIT_1170_KEY_ACCOUNT_PROFILE, "apiKey">>
> {
  const directory = accounts_dir_fun();
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Array<Omit<SHIT_1170_KEY_ACCOUNT_PROFILE, "apiKey">> = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    try {
      const text = await readFile(`${directory}/${name}`, "utf8");
      const profile = JSON.parse(text) as SHIT_1170_KEY_ACCOUNT_PROFILE;
      const { apiKey: _apiKey, ...safe } = profile;
      out.push(safe);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.accountId.localeCompare(b.accountId));
}

/**
 * the stored profile for one account, with its api key.
 */
async function account_get_fun(
  account_id: string,
): Promise<SHIT_1170_KEY_ACCOUNT_PROFILE | null> {
  const safe = account_id.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe) throw new Error("account id is required");
  try {
    const text = await readFile(`${accounts_dir_fun()}/${safe}.json`, "utf8");
    return JSON.parse(text) as SHIT_1170_KEY_ACCOUNT_PROFILE;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * the account to queue for.
 *
 * with a name, that one. without one, the only one stored — and when
 * there is more than one, the caller is asked which, because guessing
 * would queue for the wrong account.
 */
export async function shit_1170_account_resolve_fun(
  account_id?: string,
): Promise<SHIT_1170_KEY_ACCOUNT_PROFILE> {
  if (account_id) {
    const profile = await account_get_fun(account_id);
    if (!profile) {
      throw new Error(
        `no api key is stored for ${account_id}; run the engine skill's keyring set --account ${account_id} --api-key <key>`,
      );
    }
    return profile;
  }

  const profiles = await account_list_fun();
  if (profiles.length === 0) {
    throw new Error(
      "no api key is stored; run the engine skill's keyring set --account <account_id> --api-key <key>",
    );
  }
  if (profiles.length > 1) {
    throw new Error(
      `more than one account is stored (${profiles.map((item) => item.accountId).join(", ")}); pass --account`,
    );
  }
  const profile = await account_get_fun(profiles[0]?.accountId ?? "");
  if (!profile) throw new Error("the stored account profile could not be read");
  return profile;
}
