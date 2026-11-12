// where this skill keeps its files.
//
// --- WHY THE SAME HOME AS THE ENGINE SKILL ---
// the engine skill owns the queueing mechanics and writes its local
// copy of every queued batch under `${HOME}/.shit-1170-rex-engine/queue/`.
// this skill's files belong to the same family, so they live in the same
// folder, under their own `chess/` subfolder. one home, one place to
// look, one `SHIT_1170_REX_HOME` override for all of it.
//
// --- WHY A `chess/` SUBFOLDER AND NOT FILES AT THE ROOT ---
// the root already holds `accounts/`, `queue/`, `tx/`, `keys/` and
// `irc/`, each owned by a different skill. a `chess/` folder keeps this
// skill's files together and lets each skill add folders of its own
// without a naming argument.
//
// --- WHY THE STORE IS UNDER HOME AND NOT UNDER THE REPO ---
// the store holds the daemon's state and its game history. a repo gets
// committed, a repo gets cloned, and a repo gets copied into a backup.
// a folder in the home directory does not.

import { homedir } from "node:os";
import { join } from "node:path";

export const SHIT_1170_HOME_DIR_NAME = ".shit-1170-rex-engine";

export function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), SHIT_1170_HOME_DIR_NAME);
}

/**
 * the folder this skill owns: `${HOME}/.shit-1170-rex-engine/chess/`.
 */
export function shit_1170_chess_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "chess");
}

/**
 * the file the daemon writes its current state to.
 *
 * the daemon is a long-lived process, and nothing talks to it over
 * http. so the state is a FILE, and reading it is how a human — or
 * another bin — finds out what the daemon is doing right now.
 */
export function shit_1170_chess_daemon_state_path_fun(): string {
  return join(shit_1170_chess_dir_fun(), "daemon.json");
}

/**
 * the file the daemon appends one line to per event.
 *
 * a jsonl file, because it is appended to while the daemon runs and a
 * json file would be rewritten whole on every line.
 */
export function shit_1170_chess_log_path_fun(): string {
  return join(shit_1170_chess_dir_fun(), "log.jsonl");
}

/**
 * the sqlite file holding the games this agent played.
 *
 * the history of a game is worth keeping: the agent's elo moves with
 * it, and a daemon that is restarted should know which games are still
 * open rather than rediscovering them from the chain.
 */
export function shit_1170_chess_games_db_path_fun(): string {
  return join(shit_1170_chess_dir_fun(), "games.sqlite");
}

/**
 * the file the daemon claims while it runs.
 *
 * one daemon plays one account. a second daemon on the same account
 * reads the same board, picks its own move, and sends it — and one of
 * the two moves is always stale by the time it lands, because the
 * contract checks the move against the board as it is at that moment.
 * the loser of that race pays gas for an "Illegal move".
 *
 * so the daemon claims a file, and a second one is told plainly that
 * the account is already being played.
 */
export function shit_1170_chess_lock_path_fun(): string {
  return join(shit_1170_chess_dir_fun(), "daemon.lock");
}
