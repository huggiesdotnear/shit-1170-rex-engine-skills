import { homedir } from "node:os";
import { join } from "node:path";

export const SHIT_1170_HOME_DIR_NAME = ".shit-1170-rex-engine";

export function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), SHIT_1170_HOME_DIR_NAME);
}

export function shit_1170_accounts_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "accounts");
}

export function shit_1170_queue_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "queue");
}

export function shit_1170_tx_queue_dir_fun(): string {
  return join(shit_1170_queue_dir_fun(), "tx");
}

export function shit_1170_swap_queue_dir_fun(): string {
  return join(shit_1170_queue_dir_fun(), "swap");
}

export function shit_1170_queues_path_fun(): string {
  return join(shit_1170_queue_dir_fun(), "index.json");
}

export function shit_1170_account_file_name_fun(account_id: string): string {
  const safe = account_id.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe) throw new Error("account id is required");
  return `${safe}.json`;
}

export function shit_1170_account_path_fun(account_id: string): string {
  return join(
    shit_1170_accounts_dir_fun(),
    shit_1170_account_file_name_fun(account_id),
  );
}
