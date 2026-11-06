import { homedir } from "node:os";
import { join } from "node:path";

// the home of the local store.
//
// --- WHY --- THE PATH IS WRITTEN HERE AND NOT IMPORTED: the contact
// list belongs to this skill — it is the FT skill's safety check — and
// a skill that reaches into a sibling folder for its own state is a
// skill that cannot be copied out on its own.
//
// --- WHY --- THE DIRECTORY IS THE ENGINE'S: the engine skill and this
// skill share one store, so a contact added here is the same contact
// the engine skill sees, and the queue records live beside it.
export const SHIT_1170_HOME_DIR_NAME = ".shit-1170-rex-engine";

export function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), SHIT_1170_HOME_DIR_NAME);
}

export function shit_1170_contacts_path_fun(): string {
  return join(shit_1170_home_dir_fun(), "contacts.json");
}

// the accounts the engine holds a key for. the engine skill owns the
// keyring; this skill only READS the account ids, so a bin can pick
// the signing account for a read that needs one.
export function shit_1170_accounts_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "accounts");
}
