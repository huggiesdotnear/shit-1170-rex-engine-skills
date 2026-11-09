import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { shit_1170_tx_db_path_fun } from "./paths";

// the local record of every transaction already looked up.
//
// --- WHY THE RAW PAYLOAD IS STORED ---
// the bin prints the endpoint's own json, so what is cached must be
// that json and nothing else. a stored row that had been reshaped
// would print differently from a fresh fetch of the same hash, and
// the two answers would disagree for no reason a reader could see.
//
// --- WHY ONE ROW PER HASH AND NETWORK ---
// the lookup is by hash, so the hash is the key. a transaction is
// immutable once it is on chain, so a stored one never goes stale. the
// network is part of the key because the same hash can exist on
// mainnet and on testnet, and they are different transactions.
//
// --- WHY SQLITE AND NOT A JSON FILE ---
// a json file holding every transaction an agent has ever read grows
// without bound, and every write rewrites the whole thing. sqlite
// writes one row at a time and answers "have I seen this hash" with a
// single indexed read.

export interface SHIT_1170_TX_DB {
  db: Database;
  path: string;
}

/**
 * open the local transaction store, creating the file and the table.
 *
 * the folder is made first: the home directory may not exist yet on a
 * machine where nothing has run before.
 */
export function shit_1170_tx_db_open_fun(): SHIT_1170_TX_DB {
  const path = shit_1170_tx_db_path_fun();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });

  // WAL keeps a read from blocking a write, and the busy timeout
  // makes a second agent wait for the lock instead of failing.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      hash TEXT NOT NULL,
      network TEXT NOT NULL,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (hash, network)
    );
  `);

  return { db, path };
}

/**
 * the stored payload for a hash, or null when it was never looked up.
 */
export function shit_1170_tx_db_get_fun(
  db: Database,
  hash: string,
  network: string,
): string | null {
  const row = db
    .query(
      "SELECT payload FROM transactions WHERE hash = ? AND network = ?;",
    )
    .get(hash, network) as { payload: string } | null;
  return row?.payload ?? null;
}

/**
 * remember a transaction's payload.
 *
 * the write replaces an existing row for the same hash, so a
 * transaction that was fetched twice ends up stored once.
 */
export function shit_1170_tx_db_put_fun(
  db: Database,
  hash: string,
  network: string,
  payload: string,
): void {
  db.query(
    `INSERT INTO transactions (hash, network, payload, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(hash, network) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at;`,
  ).run(hash, network, payload, Date.now());
}

/**
 * how many transactions the local store holds.
 */
export function shit_1170_tx_db_count_fun(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM transactions;").get() as {
    n: number;
  };
  return row.n;
}
