import { readdir } from "node:fs/promises";
import {
  shit_1170_account_path_fun,
  shit_1170_accounts_dir_fun,
} from "./paths";
import {
  shit_1170_read_json_fun,
  shit_1170_write_json_fun,
} from "./json_io";
import type { SHIT_1170_ACCOUNT_PROFILE } from "./types";

export async function shit_1170_account_set_fun(
  account_id: string,
  api_key: string,
  options: { baseUrl?: string; label?: string } = {},
): Promise<SHIT_1170_ACCOUNT_PROFILE> {
  const id = account_id.trim();
  const key = api_key.trim();
  if (!id) throw new Error("account id is required");
  if (!key) throw new Error("api key is required");
  const now = Date.now();
  const existing = await shit_1170_read_json_fun<SHIT_1170_ACCOUNT_PROFILE>(
    shit_1170_account_path_fun(id),
  );
  const profile: SHIT_1170_ACCOUNT_PROFILE = {
    accountId: id,
    apiKey: key,
    baseUrl: options.baseUrl ?? existing?.baseUrl,
    label: options.label ?? existing?.label,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await shit_1170_write_json_fun(
    shit_1170_account_path_fun(id),
    profile,
    true,
  );
  return profile;
}

export async function shit_1170_account_get_fun(
  account_id: string,
): Promise<SHIT_1170_ACCOUNT_PROFILE | null> {
  return shit_1170_read_json_fun<SHIT_1170_ACCOUNT_PROFILE>(
    shit_1170_account_path_fun(account_id),
  );
}

export async function shit_1170_account_remove_fun(account_id: string): Promise<boolean> {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(shit_1170_account_path_fun(account_id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function shit_1170_account_list_fun(): Promise<
  Array<Omit<SHIT_1170_ACCOUNT_PROFILE, "apiKey">>
> {
  const directory = shit_1170_accounts_dir_fun();
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Array<Omit<SHIT_1170_ACCOUNT_PROFILE, "apiKey">> = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    const profile = await shit_1170_read_json_fun<SHIT_1170_ACCOUNT_PROFILE>(
      `${directory}/${name}`,
    );
    if (!profile) continue;
    const { apiKey: _apiKey, ...safe } = profile;
    out.push(safe);
  }
  return out.sort((a, b) => a.accountId.localeCompare(b.accountId));
}

export async function shit_1170_account_resolve_fun(
  account_id?: string,
): Promise<SHIT_1170_ACCOUNT_PROFILE> {
  if (account_id) {
    const profile = await shit_1170_account_get_fun(account_id);
    if (!profile) {
      throw new Error(
        `no api key is stored for ${account_id}; run keyring set --account ${account_id} --api-key <key>`,
      );
    }
    return profile;
  }

  const profiles = await shit_1170_account_list_fun();
  if (profiles.length === 0) {
    throw new Error(
      "no api key is stored; run keyring set --account <account_id> --api-key <key>",
    );
  }
  if (profiles.length > 1) {
    throw new Error(
      `more than one account is stored (${profiles.map((item) => item.accountId).join(", ")}); pass --account`,
    );
  }
  const profile = await shit_1170_account_get_fun(profiles[0].accountId);
  if (!profile) throw new Error("the stored account profile could not be read");
  return profile;
}
