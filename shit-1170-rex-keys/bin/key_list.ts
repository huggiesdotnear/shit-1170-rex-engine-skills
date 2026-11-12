#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_keys_added_list_fun,
  shit_1170_keys_db_open_fun,
  shit_1170_keys_db_list_fun,
} from "../src/index";

// list the keys this agent generated, and the ones it offered.
//
// --- WHAT THIS LISTS ---
// two lists. the GENERATED keys are every key pair this agent ever
// made. the OFFERED keys are the ones that were queued for an account,
// with the contract, the methods and the allowance they were offered
// with.
//
// --- WHY THE SECRET IS NOT IN EITHER LIST ---
// the private key and the seed phrase are not printed. a listing is a
// thing an agent reads and then repeats in a conversation, and a secret
// that is read is a secret that is copied.
//
// use `key_generate.ts --show-seed` when the phrase is wanted, and say
// why.
//
// --- WHY THE TWO LISTS ARE SEPARATE ---
// a key that was generated and never offered is a key nobody else has
// and nobody uses. a key that was offered is a key that is on its way to
// an account. the two are different states and the difference matters.

function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "generated", "offered"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "key_list [--generated] [--offered] [--account <account_id>]",
        "--generated lists the key pairs this agent made",
        "--offered lists the keys that were queued for an account",
        "--account narrows the offered list to one account",
      ],
    });
    return Promise.resolve();
  }

  return (async () => {
    const wantGenerated = args_bool_fun(args, "generated");
    const wantOffered = args_bool_fun(args, "offered");
    // --- WHY BOTH BY DEFAULT: a caller that asks for the keys wants
    // the keys, and the two lists are short. a caller that wants only
    // one says so.
    const showGenerated = wantGenerated || !wantOffered;
    const showOffered = wantOffered || !wantGenerated;

    const accountFilter = args_string_fun(args, "account")?.trim() ?? null;

    const result: Record<string, unknown> = { ok: true };

    if (showGenerated) {
      const store = shit_1170_keys_db_open_fun();
      try {
        result.generated = shit_1170_keys_db_list_fun(store.db);
        result.store_path = store.path;
      } finally {
        store.db.close();
      }
    }

    if (showOffered) {
      let offered = await shit_1170_keys_added_list_fun();
      if (accountFilter !== null) {
        offered = offered.filter((one) => one.account_id === accountFilter);
      }
      result.offered = offered;
    }

    print_json_fun(result);
  })();
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
