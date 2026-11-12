#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_key_chain_list_fun,
  shit_1170_keys_db_held_fun,
  shit_1170_keys_db_open_fun,
} from "../src/index";

// list the ACCESS KEYS of an account, read off the chain.
//
// --- WHAT THIS DOES ---
// it reads the account's access keys and prints them: the public key,
// whether the key is full access or limited, the contract it may call,
// the methods, the allowance, and the nonce.
//
// --- WHY IT IS A READ AND NOT A QUEUE ---
// a view is a read. it needs no api key, no engine account, and no
// signature, and it changes nothing. this is the same kind of read as
// `check_contract.ts` in the engine skill.
//
// --- WHY `held_locally` IS MARKED ---
// the chain says which keys an account has. it does not say which of
// them THIS AGENT can sign with. the agent's own store answers that,
// so a key it holds is marked and a key it does not hold is not.
//
// the mark is the reason to run this before queueing a removal: the
// agent knows which keys are its own, and a key it does not hold was
// made by somebody else.
//
// --- WHY A FULL ACCESS KEY IS CALLED OUT ---
// a full access key IS the account — it can move the money and do
// anything the account can do. removing one locks the holder out, and
// the engine refuses to queue that. so the listing says plainly which
// keys are full access, because that is the difference between a key
// that can be taken away and one that cannot.

function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "limited-only"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "key_chain --account-id <account_id> [--network mainnet|testnet] [--limited-only]",
        "key_chain --account-id alice.near",
        "--limited-only hides the full access keys, which are the account itself",
      ],
    });
    return Promise.resolve();
  }

  return (async () => {
    const accountId = args_string_fun(args, "account-id")?.trim() ?? "";
    if (!accountId) {
      throw new Error("--account-id <account_id> is required");
    }

    const networkRaw = args_string_fun(args, "network") ?? "mainnet";
    if (networkRaw !== "mainnet" && networkRaw !== "testnet") {
      throw new Error(`--network must be mainnet or testnet, got "${networkRaw}"`);
    }

    const store = shit_1170_keys_db_open_fun();
    let held: Set<string>;
    try {
      held = shit_1170_keys_db_held_fun(store.db);
    } finally {
      store.db.close();
    }

    const result = await shit_1170_key_chain_list_fun(accountId, {
      network: networkRaw,
      held_public_keys: held,
    });

    if (args_bool_fun(args, "limited-only")) {
      result.keys = result.keys.filter((one) => !one.full_access);
    }

    print_json_fun({
      ok: true,
      ...result,
      limited_count: result.keys.filter((one) => !one.full_access).length,
      full_access_count: result.keys.filter((one) => one.full_access).length,
    });
  })();
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
