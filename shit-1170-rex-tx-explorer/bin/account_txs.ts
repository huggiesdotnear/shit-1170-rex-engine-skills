#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { api_account } from "@sleet-js/fastnear-explorer-api-client";

// read an ACCOUNT'S TRANSACTION HISTORY.
//
// --- WHY THIS BIN EXISTS ---
// the engine skill's `tx_status.ts` reads one transaction the engine
// already knows the hash of. this one answers the question before
// that: what did this account actually do? it lists the account's
// transactions, newest first.
//
// --- WHY THE HISTORY ENDPOINT ---
// POST /v0/account gives an account's transactions as metadata rows:
// the hash, the block, the timestamp, and the flags that say how the
// account was involved — signer, receiver, and the rest. the
// transaction endpoint gives one transaction's full detail, so asking
// it for an account's history would mean asking for the account's
// hashes first. this bin is that first step.
//
// --- WHY THE RESPONSE IS PRINTED AS IT CAME ---
// the api's own json is the answer, and the rows are already small.
// reshaping them would mean choosing what to keep, and an agent that
// needs a field this bin dropped would have no way to get it back.
// so the endpoint's response is printed as it came.
//
// --- WHY THIS ENDPOINT IS NEVER CACHED ---
// an account's history grows. every read of it may find a new
// transaction at the top, so a stored copy would be a history that
// stops at the moment it was saved — and the agent would not know
// that the account has moved on. the sibling `tx.ts` bin caches, and
// it can: a transaction on chain never changes, so a stored one is
// still true. a history is not the same kind of thing.
//
// so every call here goes to the api.

const SHIT_1170_ACCOUNT_TX_DEFAULT_LIMIT = 50;
const SHIT_1170_ACCOUNT_TX_MAX_LIMIT = 1000;

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "asc"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "account_txs --account-id <account_id> [--limit <n>] [--asc] [--network mainnet|testnet]",
        "account_txs --account-id <account_id> --resume-token <token>",
      ],
    });
    return;
  }

  const accountId = args_require_string_fun(args, "account-id");
  const network = args_string_fun(args, "network") ?? "mainnet";
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error(`--network must be mainnet or testnet, got "${network}"`);
  }

  const limit =
    args_number_fun(args, "limit", SHIT_1170_ACCOUNT_TX_DEFAULT_LIMIT) ??
    SHIT_1170_ACCOUNT_TX_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a whole number of at least 1, got "${limit}"`);
  }
  if (limit > SHIT_1170_ACCOUNT_TX_MAX_LIMIT) {
    throw new Error(
      `--limit may be at most ${SHIT_1170_ACCOUNT_TX_MAX_LIMIT}, got ${limit}`,
    );
  }

  // --- WHY THE ORDER FLIPS: newest first is what a reader of an
  // account wants — the question is usually "what did this account
  // just do". the api defaults to oldest first, and `--asc` asks for
  // that back.
  const desc = !args_bool_fun(args, "asc");

  const resumeToken = args_string_fun(args, "resume-token");

  const response = await api_account({
    account_id: accountId,
    limit,
    desc,
    ...(resumeToken === undefined || resumeToken.length === 0
      ? {}
      : { resume_token: resumeToken }),
    config: { network },
    quiet: true,
  });

  print_json_fun(response);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
