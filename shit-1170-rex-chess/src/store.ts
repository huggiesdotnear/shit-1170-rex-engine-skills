// the daemon's own files.
//
// --- WHY THE STATE IS A FILE AND NOT A SERVER ---
// the irc skill's daemon is a SERVER: it holds the connection open and
// serves an http api, because a human has to talk to it WHILE it
// holds the connection.
//
// the chess daemon has nobody to talk to. it watches, it decides, it
// plays. so it is a plain long-lived process, and its state is a file
// that can be read without asking it.
//
// --- WHAT IS IN THE STORE ---
//   daemon.json   what the daemon is doing right now
//   log.jsonl     one line per event, appended to
//   games.sqlite  the games it plays and how they went

import { Database } from "bun:sqlite";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import {
  shit_1170_chess_daemon_state_path_fun,
  shit_1170_chess_dir_fun,
  shit_1170_chess_games_db_path_fun,
  shit_1170_chess_log_path_fun,
} from "./paths";
import type {
  SHIT_1170_CHESS_DAEMON_STATE,
  SHIT_1170_CHESS_GAME_ID,
} from "./types";

/**
 * make the skill's folder, and set its mode.
 *
 * the folder holds the daemon's state and its game history. it is not
 * a secret the way the keys store is, but 0700 keeps it to the account
 * that runs the daemon.
 */
export function shit_1170_chess_store_make_fun(): string {
  const dir = shit_1170_chess_dir_fun();
  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // a filesystem that cannot do the mode is not a reason to refuse
    // the work.
  }
  return dir;
}

/**
 * write the daemon's current state.
 *
 * the write is atomic enough: it goes to a temporary file and is
 * renamed over the old one, so a reader never sees half a state.
 */
export function shit_1170_chess_state_write_fun(
  state: SHIT_1170_CHESS_DAEMON_STATE,
): void {
  shit_1170_chess_store_make_fun();
  const path = shit_1170_chess_daemon_state_path_fun();
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(temp, 0o600);
  // the rename is the atomic part.
  renameSync(temp, path);
}

/**
 * read the daemon's current state.
 *
 * null when there is none — the daemon has not run, or it is not
 * running.
 */
export function shit_1170_chess_state_read_fun(): SHIT_1170_CHESS_DAEMON_STATE | null {
  try {
    return JSON.parse(
      readFileSync(shit_1170_chess_daemon_state_path_fun(), "utf8"),
    ) as SHIT_1170_CHESS_DAEMON_STATE;
  } catch {
    return null;
  }
}

/**
 * append one line to the daemon's log.
 *
 * a jsonl file, because the daemon appends to it while it runs and a
 * json file would be rewritten whole on every line.
 */
export function shit_1170_chess_log_append_fun(entry: {
  at: number;
  event: string;
  detail?: Record<string, unknown>;
}): void {
  shit_1170_chess_store_make_fun();
  const path = shit_1170_chess_log_path_fun();
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  try {
    chmodSync(path, 0o600);
  } catch {
    // as above.
  }
}

// --- THE GAME HISTORY ---

/**
 * open the game history, creating the file and the table.
 */
export function shit_1170_chess_games_db_open_fun(): Database {
  const path = shit_1170_chess_games_db_path_fun();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      game_id      TEXT NOT NULL PRIMARY KEY,
      height       INTEGER NOT NULL,
      white        TEXT NOT NULL,
      black        TEXT,
      opened_at    INTEGER NOT NULL,
      closed_at    INTEGER,
      outcome      TEXT,
      result       TEXT
    );
  `);

  try {
    chmodSync(path, 0o600);
  } catch {
    // as above.
  }

  return db;
}

/**
 * remember a game the daemon opened.
 */
export function shit_1170_chess_games_put_fun(
  db: Database,
  game_id: SHIT_1170_CHESS_GAME_ID,
  opened_at: number,
): void {
  const [height, white, black] = game_id;
  db.query(
    `INSERT INTO games (game_id, height, white, black, opened_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO NOTHING;`,
  ).run(JSON.stringify(game_id), height, white, black, opened_at);
}

/**
 * close a game, with its outcome.
 */
export function shit_1170_chess_games_close_fun(
  db: Database,
  game_id: SHIT_1170_CHESS_GAME_ID,
  closed_at: number,
  outcome: string,
  result: string | null,
): void {
  db.query(
    `UPDATE games SET closed_at = ?, outcome = ?, result = ?
     WHERE game_id = ?;`,
  ).run(closed_at, outcome, result, JSON.stringify(game_id));
}

/**
 * the games the daemon has open.
 */
export function shit_1170_chess_games_open_fun(
  db: Database,
): SHIT_1170_CHESS_GAME_ID[] {
  const rows = db
    .query(
      `SELECT game_id FROM games WHERE closed_at IS NULL ORDER BY opened_at ASC;`,
    )
    .all() as { game_id: string }[];

  const games: SHIT_1170_CHESS_GAME_ID[] = [];
  for (const row of rows) {
    try {
      games.push(JSON.parse(row.game_id) as SHIT_1170_CHESS_GAME_ID);
    } catch {
      continue;
    }
  }
  return games;
}

/**
 * the games the daemon has played, and how they went.
 */
export function shit_1170_chess_games_history_fun(
  db: Database,
  limit = 50,
): {
  game_id: SHIT_1170_CHESS_GAME_ID;
  opened_at: number;
  closed_at: number | null;
  outcome: string | null;
  result: string | null;
}[] {
  const rows = db
    .query(
      `SELECT game_id, opened_at, closed_at, outcome, result
       FROM games ORDER BY opened_at DESC LIMIT ?;`,
    )
    .all(limit) as {
    game_id: string;
    opened_at: number;
    closed_at: number | null;
    outcome: string | null;
    result: string | null;
  }[];

  return rows.map((row) => ({
    game_id: JSON.parse(row.game_id) as SHIT_1170_CHESS_GAME_ID,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    outcome: row.outcome,
    result: row.result,
  }));
}
