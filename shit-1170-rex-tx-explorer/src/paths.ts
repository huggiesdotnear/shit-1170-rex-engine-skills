import { homedir } from "node:os";
import { join } from "node:path";

export const SHIT_1170_HOME_DIR_NAME = ".shit-1170-rex-engine";

export function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), SHIT_1170_HOME_DIR_NAME);
}

export function shit_1170_tx_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "tx");
}

/**
 * the sqlite file that holds the transactions already looked up.
 *
 * it lives under the tx/ folder so the local store keeps one folder
 * per kind of thing it remembers, beside the queue/ the engine skill
 * writes.
 */
export function shit_1170_tx_db_path_fun(): string {
  return join(shit_1170_tx_dir_fun(), "explorer.sqlite");
}
