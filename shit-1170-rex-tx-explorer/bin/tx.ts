#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { api_transactions } from "@sleet-js/fastnear-explorer-api-client";

import {
  shit_1170_tx_db_get_fun,
  shit_1170_tx_db_open_fun,
  shit_1170_tx_db_put_fun,
} from "../src/index";

// read TRANSACTIONS BY HASH, and never read the same one twice.
//
// --- WHY THE LOCAL STORE EXISTS ---
// a transaction on chain never changes, so looking one up a second
// time gets the same answer and spends a request to do it. the fastnear
// api rate limits at about five requests a second, so a repeated
// lookup is not just wasted — it can push the other bins off the
// limit. so every transaction that was read is kept in a local sqlite
// store, and the store is asked first.
//
// --- WHY THIS ENDPOINT CAN BE CACHED AND THE HISTORY ONE CANNOT ---
// a transaction is immutable: the moment it is on chain its hash
// always names the same actions, the same receipts, and the same
// outcome. so a stored transaction is never stale, and serving it
// instead of asking again is always right. an account's HISTORY is
// the opposite — it grows, so a stored copy would be a history that
// stops at the moment it was saved. that is why `account_txs.ts` never
// caches and this bin always does.
//
// --- WHY THE STORE IS SQLITE ---
// a json file of everything read grows without bound and rewrites
// whole on every write. sqlite writes one row at a time and answers
// "have I seen this hash" with one indexed read.
//
// --- WHY THE RESPONSE IS PRINTED AS IT CAME ---
// the api's own json is the answer. a cached transaction prints the
// same json a fresh fetch would, because what is cached IS the
// endpoint's payload, untouched. reshaping it would mean choosing
// what to keep, and an agent that needed a dropped field would have no
// way to get it back.

const SHIT_1170_TX_MAX_HASHES = 20;

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "refresh"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "tx --tx-hash <hash> [<hash> ...] [--network mainnet|testnet]",
        "tx --tx-hash <hash> [--refresh]   # ignore the local copy and fetch again",
      ],
    });
    return;
  }

  // a hash per --tx-hash flag, or a bare list of hashes. the arg
  // parser's map holds ONE value per flag, so a repeated --tx-hash is
  // the last one — the bare list is the way to ask for many.
  const hashes: string[] = [];
  const flagHash = args_string_fun(args, "tx-hash");
  if (flagHash !== undefined && flagHash.trim().length > 0) {
    hashes.push(flagHash.trim());
  }
  for (const positional of args.positional) {
    if (positional === "help") continue;
    const trimmed = positional.trim();
    if (trimmed.length > 0) hashes.push(trimmed);
  }

  if (hashes.length === 0) {
    throw new Error("--tx-hash <hash> is required");
  }
  if (hashes.length > SHIT_1170_TX_MAX_HASHES) {
    throw new Error(
      `at most ${SHIT_1170_TX_MAX_HASHES} hashes per call, got ${hashes.length}`,
    );
  }

  const network = args_string_fun(args, "network") ?? "mainnet";
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error(`--network must be mainnet or testnet, got "${network}"`);
  }

  // --- WHY REFRESH EXISTS: the store is meant to make a transaction
  // be read once, so a reader who wants the endpoint's answer right
  // now — not the copy from earlier — needs a way past it.
  const refresh = args_bool_fun(args, "refresh");

  const store = shit_1170_tx_db_open_fun();

  try {
    const cached: Record<string, string> = {};
    const missing: string[] = [];

    for (const hash of hashes) {
      if (refresh) {
        missing.push(hash);
        continue;
      }
      const payload = shit_1170_tx_db_get_fun(store.db, hash, network);
      if (payload === null) {
        missing.push(hash);
      } else {
        cached[hash] = payload;
      }
    }

    // the hashes that were not in the store are asked for, in ONE
    // request — the endpoint takes a list, so ten missing hashes cost
    // one call and not ten.
    if (missing.length > 0) {
      const response = await api_transactions({
        tx_hashes: missing,
        config: { network },
        quiet: true,
      });

      // the endpoint answers with fewer transactions than asked for
      // when it does not know one, so the answer is read back by hash
      // rather than by position.
      for (const detail of response.transactions) {
        const hash = detail.transaction?.hash;
        if (typeof hash !== "string") continue;
        const payload = JSON.stringify(detail);
        cached[hash] = payload;
        shit_1170_tx_db_put_fun(store.db, hash, network, payload);
      }
    }

    // --- WHY THE ANSWER IS THE ENDPOINT'S OWN SHAPE: the endpoint
    // answers with a `transactions` array, so that is what is printed.
    // a cached transaction is printed in the same place a fetched one
    // is, and in the same shape, because the cached payload IS the
    // endpoint's own transaction object.
    const transactions = hashes
      .map((hash) => cached[hash])
      .filter((payload): payload is string => payload !== undefined)
      .map((payload) => JSON.parse(payload));

    const answered = new Set(
      transactions.map((detail) => detail.transaction?.hash),
    );
    const notAnswered = hashes.filter((hash) => !answered.has(hash));

    print_json_fun({
      transactions,
      ...(notAnswered.length > 0
        ? {
            not_answered: notAnswered,
            note: "the api did not answer with these hashes. the hash may be wrong, or the transaction may not be indexed yet.",
          }
        : {}),
    });

    if (notAnswered.length > 0) process.exitCode = 1;
  } finally {
    store.db.close();
  }
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
