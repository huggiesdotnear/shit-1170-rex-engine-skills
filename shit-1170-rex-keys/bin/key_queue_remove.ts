#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_key_action_transaction_fun,
  shit_1170_key_chain_list_fun,
  shit_1170_key_queue_fun,
  shit_1170_keys_added_get_fun,
  shit_1170_keys_added_put_fun,
  shit_1170_keys_db_open_fun,
  shit_1170_keys_db_held_fun,
  SHIT_1170_KEY_ACTION_REMOVE,
  type SHIT_1170_KEY_ADDED,
} from "../src/index";
import { shit_1170_account_resolve_fun } from "./account";
import { shit_1170_local_queue_record_put_fun } from "./local_queue";

// queue the REMOVAL of a limited access key from an account.
//
// --- WHAT THIS DOES ---
// it queues a `delete_key` for the account. the human approves it in
// the web app with their wallet, and the key comes off the account
// then.
//
// --- WHY THE BACKEND CHECKS THE CHAIN AND THIS BIN DOES NOT ---
// the backend reads the account's keys before it writes the batch, and
// refuses a `delete_key` that names a key which is not there, or which
// is a FULL ACCESS key. a full access key IS the account: removing it
// locks the holder out of their own money.
//
// so the refusal is the backend's, and it happens before anything is
// written. this bin does not pre-check it, because the chain is the
// truth and the backend reads it at the moment of the write.
//
// --- WHY THE KEY CAN BE NAMED OR TAKEN FROM THE STORE ---
// `--public-key` names the key. without it, the bin uses the key this
// agent offered to that account — the one the agent knows about. an
// agent removing a key it put there should not have to remember the
// public key.

function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "skip-chain-check"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "key_queue_remove --public-key <ed25519:...> [--account <account_id>]",
        "key_queue_remove --account <account_id>   # removes the key this agent offered that account",
      ],
    });
    return Promise.resolve();
  }

  return (async () => {
    const profile = await shit_1170_account_resolve_fun(
      args_string_fun(args, "account"),
    );
    const accountId = profile.accountId;

    let publicKey = args_string_fun(args, "public-key")?.trim() ?? null;

    // --- WHY THE STORE IS THE FALLBACK: an agent that offered a key
    // knows it. asking it for a public key the agent already wrote
    // down is a step that adds nothing.
    if (publicKey === null) {
      const offered = await shit_1170_keys_added_get_fun(
        await last_offered_key_fun(accountId),
      );
      if (!offered) {
        throw new Error(
          "--public-key <ed25519:...> is required: no key of this agent's was offered to this account",
        );
      }
      publicKey = offered.public_key;
    }

    // --- WHY THE CHAIN IS READ FIRST: the backend refuses a
    // delete_key for a full access key, and a full access key IS the
    // account. reading the keys here lets the bin say so BEFORE the
    // batch is written, with the reason in plain words.
    if (!args_bool_fun(args, "skip-chain-check")) {
      const store = shit_1170_keys_db_open_fun();
      let held: Set<string>;
      try {
        held = shit_1170_keys_db_held_fun(store.db);
      } finally {
        store.db.close();
      }

      const onChain = await shit_1170_key_chain_list_fun(accountId, {
        held_public_keys: held,
      });
      const found = onChain.keys.find(
        (one) => one.public_key === publicKey,
      );
      if (!found) {
        // --- WHY THE MESSAGE SAYS WHICH OF THE TWO IT IS: a key that
        // is QUEUED but not yet approved is not on the chain, and a key
        // that was never there is not either. the chain cannot tell
        // them apart, but the agent's own store can: it knows which
        // keys it offered. so the message says which one this is,
        // because "it is not there" on its own reads like a mistake.
        const offered = await shit_1170_keys_added_get_fun(publicKey);
        if (offered && offered.action === "add_key") {
          throw new Error(
            `the key ${publicKey} is not on the account ${accountId} yet — it was QUEUED for it (queue ${offered.queue_id}) and the human has not approved it. there is nothing to remove until it is on the account.`,
          );
        }
        throw new Error(
          `the account ${accountId} has no access key ${publicKey}; nothing to remove`,
        );
      }
      if (found.full_access) {
        throw new Error(
          `the key ${publicKey} is a FULL ACCESS key — it IS the account. the engine refuses to queue its removal, because removing it locks the holder out.`,
        );
      }
    }

    const transaction = shit_1170_key_action_transaction_fun({
      action: SHIT_1170_KEY_ACTION_REMOVE,
      public_key: publicKey,
    });

    const queued = await shit_1170_key_queue_fun(profile.apiKey, transaction, {
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      accountId,
      what: `REMOVE A LIMITED ACCESS KEY ${publicKey}`,
    });

    const local = await shit_1170_local_queue_record_put_fun({
      kind: "tx",
      id: queued.queue_id,
      request: {
        transactions: [transaction],
        accounts: [accountId],
        what: `REMOVE A LIMITED ACCESS KEY ${publicKey}`,
      },
      response: queued.queue as unknown as Record<string, unknown>,
    });

    // --- WHY THE RECORD IS REPLACED AND NOT ADDED: the json file is
    // named after the public key, so a removal OVERWRITES the record of
    // the addition. the file then says what happened last to that key,
    // and the queue id of the removal is on it.
    const previous = await shit_1170_keys_added_get_fun(publicKey);
    const record: SHIT_1170_KEY_ADDED = {
      public_key: publicKey,
      account_id: accountId,
      action: SHIT_1170_KEY_ACTION_REMOVE,
      receiver_id: previous?.receiver_id ?? null,
      method_names: previous?.method_names ?? [],
      allowance: previous?.allowance ?? null,
      queue_id: queued.queue_id,
      tx_id: queued.tx_id,
      local_path: local.localPath,
      created_at: previous?.created_at ?? Date.now(),
      updated_at: Date.now(),
    };
    const recordPath = await shit_1170_keys_added_put_fun(record);

    print_json_fun({
      ok: true,
      public_key: publicKey,
      account_id: accountId,
      queue_id: queued.queue_id,
      tx_id: queued.tx_id,
      local_path: local.localPath,
      record_path: recordPath,
      note:
        "the removal was queued, not made. the human approves it in the web app with their wallet.",
    });
  })();
}

/**
 * the public key this agent offered to an account most recently.
 */
async function last_offered_key_fun(account_id: string): Promise<string> {
  const { shit_1170_keys_added_for_account_fun } = await import("../src/index");
  const records = await shit_1170_keys_added_for_account_fun(account_id);
  const offered = records.find((one) => one.action === "add_key");
  if (!offered) {
    throw new Error(
      `no key of this agent's was offered to ${account_id}; pass --public-key`,
    );
  }
  return offered.public_key;
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
