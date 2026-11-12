import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { shit_1170_keys_db_path_fun } from "./paths";
import type { SHIT_1170_KEY_GENERATED } from "./types";

// the sqlite store of every key pair this agent generated.
//
// --- WHY SQLITE AND NOT A JSON FILE ---
// a json file of every generated key grows without bound and every write
// rewrites the whole thing. sqlite writes one row at a time and answers
// "do I hold this public key" with a single indexed read.
//
// --- WHY THE SECRET LIVES HERE AND ONLY HERE ---
// the added-key json files hold the PUBLIC key and the details of what
// the key may call. they never hold the private key. the secret is in
// this table and in no other file, so there is exactly one place to
// look, one place to protect, and one place to wipe.
//
// --- WHY THE SEED PHRASE IS ITS OWN COLUMN ---
// a random key has no phrase and a phrase-derived key has one. keeping
// them apart means the column is either null or it is a real phrase,
// and a reader never has to ask whether the empty string means "no
// phrase" or "an empty phrase".
//
// --- WHY THE FILE IS 0600 ---
// it holds private keys and seed phrases. the file is created with the
// private mode and the mode is set again after the file exists, because
// the mode of an existing file is not changed by a write.

export interface SHIT_1170_KEYS_DB {
  db: Database;
  path: string;
}

/**
 * open the local key store, creating the file and the table.
 *
 * the folder is made first: the home directory may not exist yet on a
 * machine where nothing has run before.
 */
export function shit_1170_keys_db_open_fun(): SHIT_1170_KEYS_DB {
  const path = shit_1170_keys_db_path_fun();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });

  // WAL keeps a read from blocking a write, and the busy timeout makes
  // a second agent wait for the lock instead of failing.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      public_key      TEXT NOT NULL PRIMARY KEY,
      secret_key      TEXT NOT NULL,
      seed_phrase     TEXT,
      derivation_path TEXT,
      created_at      INTEGER NOT NULL
    );
  `);

  // the file holds secrets. it is created 0600, and the mode is set
  // again because the mode of an EXISTING file survives a write.
  try {
    chmodSync(path, 0o600);
  } catch {
    // a filesystem that cannot do the mode is not a reason to refuse
    // the work. the read and the write below still happen.
  }

  return { db, path };
}

/**
 * remember a generated key pair.
 *
 * the write replaces an existing row for the same public key, so a key
 * that was generated twice ends up stored once.
 */
export function shit_1170_keys_db_put_fun(
  db: Database,
  key: SHIT_1170_KEY_GENERATED,
): void {
  db.query(
    `INSERT INTO keys (public_key, secret_key, seed_phrase, derivation_path, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(public_key) DO UPDATE SET
       secret_key = excluded.secret_key,
       seed_phrase = excluded.seed_phrase,
       derivation_path = excluded.derivation_path;`,
  ).run(
    key.public_key,
    key.secret_key,
    key.seed_phrase,
    key.derivation_path,
    key.created_at,
  );
}

/**
 * the stored key for a public key, or null when this agent does not
 * hold it.
 */
export function shit_1170_keys_db_get_fun(
  db: Database,
  public_key: string,
): SHIT_1170_KEY_GENERATED | null {
  const row = db
    .query(
      `SELECT public_key, secret_key, seed_phrase, derivation_path, created_at
       FROM keys WHERE public_key = ?;`,
    )
    .get(public_key) as
    | {
        public_key: string;
        secret_key: string;
        seed_phrase: string | null;
        derivation_path: string | null;
        created_at: number;
      }
    | null;
  if (!row) return null;
  return {
    id: row.public_key,
    public_key: row.public_key,
    secret_key: row.secret_key,
    seed_phrase: row.seed_phrase,
    derivation_path: row.derivation_path,
    created_at: row.created_at,
  };
}

/**
 * every key this agent generated, newest first.
 *
 * the list is what `key_list.ts` prints, and it NEVER prints the secret
 * and NEVER prints the seed phrase. the caller has to ask for those by
 * name, and that ask is logged in the conversation.
 */
export function shit_1170_keys_db_list_fun(
  db: Database,
): Array<Omit<SHIT_1170_KEY_GENERATED, "secret_key" | "seed_phrase">> {
  const rows = db
    .query(
      `SELECT public_key, derivation_path, created_at
       FROM keys ORDER BY created_at DESC;`,
    )
    .all() as Array<{
    public_key: string;
    derivation_path: string | null;
    created_at: number;
  }>;
  return rows.map((row) => ({
    id: row.public_key,
    public_key: row.public_key,
    derivation_path: row.derivation_path,
    created_at: row.created_at,
    has_seed_phrase: row.derivation_path !== null,
  }));
}

/**
 * how many keys the local store holds.
 */
export function shit_1170_keys_db_count_fun(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM keys;").get() as {
    n: number;
  };
  return row.n;
}

/**
 * the public keys this agent holds, as a set.
 *
 * it is used to answer "is this key mine" for the keys read off the
 * chain, so the answer comes from the agent's own store.
 */
export function shit_1170_keys_db_held_fun(db: Database): Set<string> {
  const rows = db.query("SELECT public_key FROM keys;").all() as Array<{
    public_key: string;
  }>;
  return new Set(rows.map((row) => row.public_key));
}
