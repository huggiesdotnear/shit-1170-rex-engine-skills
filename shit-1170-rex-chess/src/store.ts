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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import {
  shit_1170_chess_daemon_state_path_fun,
  shit_1170_chess_decisions_dir_fun,
  shit_1170_chess_dir_fun,
  shit_1170_chess_games_db_path_fun,
  shit_1170_chess_lock_path_fun,
  shit_1170_chess_log_path_fun,
  shit_1170_chess_answer_path_fun,
  shit_1170_chess_request_path_fun,
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

// --- THE LOCK ---

/**
 * claim the daemon's lock for one account.
 *
 * one daemon plays one account. a second daemon on the same account
 * reads the same board, picks its own move, and sends it — and one of
 * the two moves is always stale by the time it lands, because the
 * contract checks the move against the board as it is at that moment.
 * the loser of that race pays gas for an "Illegal move".
 *
 * so the daemon claims a lock file, and a second one is told plainly
 * that the account is already being played.
 *
 * the claim is `wx` — create it, and fail if it is already there. the
 * file holds the pid, and the pid is checked before the claim: a lock
 * left behind by a daemon that died is taken over rather than blocking
 * the account forever.
 *
 * returns the lock, or throws with the pid that holds it.
 */
export function shit_1170_chess_lock_claim_fun(
  account_id: string,
): { path: string; release: () => void } {
  shit_1170_chess_store_make_fun();
  const path = shit_1170_chess_lock_path_fun();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(
        path,
        `${JSON.stringify({ account_id, pid: process.pid, at: Date.now() })}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      return {
        path,
        release: () => {
          try {
            unlinkSync(path);
          } catch {
            // the lock is gone already, or the file is not ours to
            // remove. either way there is nothing to do.
          }
        },
      };
    } catch {
      // the file exists. is the daemon that wrote it still alive?
      const holder = shit_1170_chess_lock_holder_fun(path);
      if (holder && is_alive_fun(holder.pid)) {
        throw new Error(
          `the account ${account_id} is already being played by a daemon ` +
            `with pid ${holder.pid}. one daemon plays one account — stop the ` +
            `other one first. the lock file is ${path}.`,
        );
      }

      // the holder is gone. take the lock over.
      try {
        unlinkSync(path);
      } catch {
        // as above.
      }
    }
  }

  throw new Error(
    `could not claim the daemon lock at ${path}. another daemon may have ` +
      `taken it in the meantime.`,
  );
}

/**
 * read the lock file, if there is one.
 */
export function shit_1170_chess_lock_holder_fun(
  path: string,
): { account_id: string; pid: number; at: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      account_id?: string;
      pid?: number;
      at?: number;
    };
    if (typeof parsed.pid !== "number") return null;
    return {
      account_id: parsed.account_id ?? "",
      pid: parsed.pid,
      at: parsed.at ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * is a process still running?
 *
 * signal 0 does not touch the process — it only asks whether it is
 * there to be signalled.
 */
function is_alive_fun(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // the process is gone, or it belongs to somebody else.
    return false;
  }
}

// --- THE DECISION HANDOFF ---

/**
 * write a decision request for an agent to answer.
 *
 * the daemon decides NOTHING in agent mode. it writes down what it
 * wants decided — the position and the legal moves — and waits.
 *
 * the file is written atomically, so an agent that reads it never
 * sees half a request.
 */
export function shit_1170_chess_request_write_fun(
  id: string,
  request: Record<string, unknown>,
): void {
  const dir = shit_1170_chess_decisions_dir_fun();
  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // as above.
  }

  const path = shit_1170_chess_request_path_fun(id);
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(request, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temp, path);
}

/**
 * read the answer an agent wrote, if there is one.
 */
export function shit_1170_chess_answer_read_fun(
  id: string,
): { mv?: string; note?: string } | null {
  try {
    const parsed = JSON.parse(
      readFileSync(shit_1170_chess_answer_path_fun(id), "utf8"),
    ) as { mv?: string; note?: string };
    return parsed;
  } catch {
    return null;
  }
}

/**
 * clear a request and its answer, once the decision has been made.
 */
export function shit_1170_chess_decision_clear_fun(id: string): void {
  for (const path of [
    shit_1170_chess_request_path_fun(id),
    shit_1170_chess_answer_path_fun(id),
  ]) {
    try {
      unlinkSync(path);
    } catch {
      // already gone.
    }
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

  // --- THE POSITIONS ---
  //
  // the positions each game has been through.
  //
  // the api's move history is the other source of them, but the api
  // is an index and it can be behind — then it has no history at all.
  // the contract has NO repetition rule, so a position that comes
  // round three times does not end the game; it just goes on, forever.
  //
  // so the daemon keeps its own record. it is the belt to the api's
  // braces: the api's history when it is there, this one when it is
  // not.
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      game_id    TEXT NOT NULL,
      fen        TEXT NOT NULL,
      seen_at    INTEGER NOT NULL,
      PRIMARY KEY (game_id, fen)
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
 * remember a position a game has been through.
 *
 * a position is remembered once. a game that comes round to the same
 * position three times does not end — the contract has no repetition
 * rule — so the record is what lets the chooser see the loop and
 * break it.
 */
export function shit_1170_chess_position_remember_fun(
  db: Database,
  game_id: SHIT_1170_CHESS_GAME_ID,
  fen: string,
  seen_at: number,
): void {
  db.query(
    `INSERT INTO positions (game_id, fen, seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(game_id, fen) DO NOTHING;`,
  ).run(JSON.stringify(game_id), fen, seen_at);
}

/**
 * every position a game has been through.
 */
export function shit_1170_chess_positions_fun(
  db: Database,
  game_id: SHIT_1170_CHESS_GAME_ID,
): string[] {
  const rows = db
    .query(
      `SELECT fen FROM positions WHERE game_id = ? ORDER BY seen_at ASC;`,
    )
    .all(JSON.stringify(game_id)) as Array<{ fen: string }>;
  return rows.map((row) => row.fen);
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
