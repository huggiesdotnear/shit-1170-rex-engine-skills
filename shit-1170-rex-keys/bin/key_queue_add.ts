#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_key_action_transaction_fun,
  shit_1170_key_generated_of_fun,
  shit_1170_key_make_fun,
  shit_1170_key_queue_fun,
  shit_1170_keys_added_list_fun,
  shit_1170_keys_added_put_fun,
  shit_1170_keys_db_get_fun,
  shit_1170_keys_db_open_fun,
  shit_1170_keys_db_put_fun,
  SHIT_1170_KEY_ACTION_ADD,
  type SHIT_1170_KEY_ADDED,
  type SHIT_1170_KEY_GENERATED,
} from "../src/index";
import { shit_1170_account_resolve_fun } from "./account";
import { shit_1170_local_queue_record_put_fun } from "./local_queue";

// queue the ADDITION of a limited access key to an account.
//
// --- WHAT THIS DOES ---
// it makes a NEW key pair, keeps it, and queues an `add_key` for the
// account. the human approves it in the web app with their wallet, and
// the key lands on the account then.
//
// --- WHY A NEW KEY EVERY TIME ---
// a key that was generated before and offered to somebody else is
// already out there. reusing it would mean two holders of the same
// secret, and the older holder could sign anything the newer one can.
// so a key offered to an account is always a fresh one, made here, and
// the previous ones are never picked up again.
//
// the `--public-key` flag exists for one reason only: to RE-TRY a
// failed queue with the same key. it is refused when that key was
// already offered to some account.
//
// --- WHY THE KEY IS MADE HERE AND NOT BY THE CALLER ---
// the caller asks for a limited key on a contract. making the key is
// part of doing that, and the key has to be kept somewhere safe, so the
// bin makes it and stores it. a caller that wants a key without
// offering it uses `key_generate.ts`.
//
// --- WHY THE CONTRACT, THE METHODS AND THE ALLOWANCE ARE ALL NEEDED ---
// the receiver is what makes a key limited: it says which contract the
// key may call. the methods say which of that contract's methods. the
// allowance says how much gas the key may spend.
//
// a key with no method names may call EVERY method on the contract. that
// is a bigger key than it looks, and it is stated here so the reader
// sees which one they are getting.
//
// --- WHY THE ALLOWANCE IS THE GAS BUDGET AND NOT THE DEPOSIT ---
// the allowance on a function call key is the balance the key may spend
// on GAS. the contract takes `gas_limit x gas_price` out of it before
// the call runs, and the refund comes back to the key afterwards. it is
// NOT a limit on the attached deposit, and it is NOT the account's
// balance: a function call key cannot move NEAR at all.
//
// --- WHY THE ALLOWANCE IS REQUIRED, AND NEVER ZERO ---
// a limited key always needs gas to make a call. the protocol has three
// states for the allowance field, and this skill uses exactly one of
// them:
//
//   - `--allowance <amount>` — a gas budget. the key may spend that much
//     on gas, over its whole life, and then it is dead. THIS IS THE
//     ONLY STATE THIS SKILL QUEUES.
//
//   - no allowance at all — the protocol reads an absent allowance as
//     UNLIMITED gas. the protocol allows it. this skill does not hand
//     out unlimited-gas keys, so the bin refuses it.
//
//   - `--allowance 0` — a zero gas budget. every call signed with the
//     key is refused with `NotEnoughAllowance` before the contract is
//     reached. a key that cannot make a call is not a key, so the bin
//     refuses it too.
//
// --- WHY THE ALLOWANCE IS A UNIT AMOUNT ---
// the allowance is in yoctoNEAR — 24 decimals. a human amount like
// `0.5` is NOT what goes here. use the unit conversion skill.
//
// 1 NEAR is `1000000000000000000000000`. mainnet's gas price is
// 1000000000 yoctoNEAR per gas unit, so a 30 Tgas call needs 0.03 NEAR
// of allowance and 1 NEAR covers a very large number of calls.

function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "seed", "show-seed"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "key_queue_add --receiver-id <contract_id> --method <name> --allowance <yoctoNEAR> [--account <account_id>]",
        "key_queue_add --receiver-id <contract_id> --methods ft_swap --allowance 1000000000000000000000000",
        "--allowance is REQUIRED: it is the key's GAS budget in yoctoNEAR, not the deposit. a key always needs gas to make a call.",
        "--allowance 0 is refused: a zero gas budget cannot make a call. an absent allowance would be unlimited gas, and that is refused too.",
        "--public-key <key> re-queues an addition that was refused, with that key",
        "--seed makes the key from a seed phrase; --show-seed prints it",
      ],
    });
    return Promise.resolve();
  }

  return (async () => {
    const profile = await shit_1170_account_resolve_fun(
      args_string_fun(args, "account"),
    );
    const accountId = profile.accountId;

    const receiverId = args_string_fun(args, "receiver-id")?.trim() ?? "";
    if (!receiverId) {
      throw new Error(
        "--receiver-id <contract_id> is required: it is the contract the key may call",
      );
    }

    // --- WHY THE METHODS COME FROM EITHER FLAG: `--method` is one
    // name, `--methods` is a list. an agent reading a contract's method
    // list has a list, and a human asking for one method has one name.
    const methods: string[] = [];
    const single = args_string_fun(args, "method");
    if (single !== undefined && single.trim().length > 0) {
      methods.push(single.trim());
    }
    const many = args_string_fun(args, "methods");
    if (many !== undefined) {
      for (const one of many.split(",")) {
        const trimmed = one.trim();
        if (trimmed.length > 0 && !methods.includes(trimmed)) {
          methods.push(trimmed);
        }
      }
    }

    // --- WHY THE ALLOWANCE IS REQUIRED: the allowance is the key's gas
    // budget, and a limited key ALWAYS needs gas to make a call. the
    // protocol reads an absent allowance as UNLIMITED gas, and this
    // skill does not hand out unlimited-gas keys: a gas budget is the
    // thing that keeps a shared key from being drained by whoever holds
    // it, and it is the thing the human is approving.
    //
    // so every key this skill queues carries a real number. the number
    // is sized from the calls the key will make — see the SKILL.md.
    const allowance_raw = args_string_fun(args, "allowance")?.trim() ?? null;
    if (allowance_raw === null || allowance_raw.length === 0) {
      throw new Error(
        "--allowance is required: it is the key's gas budget, and a key with no allowance gets UNLIMITED gas, which is not what this skill hands out. " +
          "pass an allowance that covers the calls the key will make (1 NEAR is 1000000000000000000000000, and 0.03 NEAR covers a 30 Tgas call).",
      );
    }
    if (!/^\d+$/.test(allowance_raw)) {
      throw new Error(
        `--allowance must be a whole number of yoctoNEAR, got "${allowance_raw}"`,
      );
    }
    const allowance: string = allowance_raw;

    // --- WHY A ZERO ALLOWANCE IS REFUSED: a budget of zero means every
    // call signed with the key fails with `NotEnoughAllowance` before the
    // contract is reached. a function call needs gas, so a zero
    // allowance is a key that cannot make one. queueing it would hand
    // out a key that looks usable and is not, so it is refused here,
    // with the reason in plain words.
    if (allowance === "0") {
      throw new Error(
        "--allowance 0 would give the key a zero gas budget: every call signed with it would be refused with NotEnoughAllowance before the contract is reached. " +
          "a function call needs gas. pass an allowance that covers the calls (1 NEAR is 1000000000000000000000000, and 0.03 NEAR covers a 30 Tgas call).",
      );
    }

    const seed = args_bool_fun(args, "seed");
    const showSeed = args_bool_fun(args, "show-seed");
    const reusePublicKey = args_string_fun(args, "public-key")?.trim() ?? null;

    const store = shit_1170_keys_db_open_fun();
    let generated: SHIT_1170_KEY_GENERATED;
    let madeByThisCall = false;

    try {
      if (reusePublicKey !== null) {
        // --- WHY A REUSED KEY MUST NOT ALREADY BE OFFERED: the whole
        // point of a fresh key is that only one person holds it. a key
        // that was already offered to an account has another holder.
        const existing = await shit_1170_keys_added_list_fun();
        const already = existing.find(
          (one) => one.public_key === reusePublicKey,
        );
        if (already) {
          throw new Error(
            `the key ${reusePublicKey} was already offered to ${already.account_id}; a key offered to an account is never offered again`,
          );
        }

        const held = shit_1170_keys_db_get_fun(store.db, reusePublicKey);
        if (!held) {
          throw new Error(
            `this agent does not hold the key ${reusePublicKey}; only a key it generated can be re-queued`,
          );
        }
        generated = held;
      } else {
        const made = shit_1170_key_make_fun({ seed });
        generated = shit_1170_key_generated_of_fun(made);
        shit_1170_keys_db_put_fun(store.db, generated);
        madeByThisCall = true;
      }

      const transaction = shit_1170_key_action_transaction_fun({
        action: SHIT_1170_KEY_ACTION_ADD,
        public_key: generated.public_key,
        receiver_id: receiverId,
        method_names: methods,
        allowance,
      });

      const queued = await shit_1170_key_queue_fun(profile.apiKey, transaction, {
        ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
        accountId,
        what: `ADD A LIMITED ACCESS KEY ${generated.public_key} ON ${receiverId}${
          methods.length > 0 ? ` (${methods.join(", ")})` : " (ANY METHOD)"
        }`,
      });

      const local = await shit_1170_local_queue_record_put_fun({
        kind: "tx",
        id: queued.queue_id,
        request: {
          transactions: [transaction],
          accounts: [accountId],
          what: `ADD A LIMITED ACCESS KEY ${generated.public_key} ON ${receiverId}`,
        },
        response: queued.queue as unknown as Record<string, unknown>,
      });

      const record: SHIT_1170_KEY_ADDED = {
        public_key: generated.public_key,
        account_id: accountId,
        action: SHIT_1170_KEY_ACTION_ADD,
        receiver_id: receiverId,
        method_names: methods,
        allowance,
        queue_id: queued.queue_id,
        tx_id: queued.tx_id,
        local_path: local.localPath,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const recordPath = await shit_1170_keys_added_put_fun(record);

      print_json_fun({
        ok: true,
        public_key: generated.public_key,
        account_id: accountId,
        receiver_id: receiverId,
        method_names: methods,
        allowance,
        queue_id: queued.queue_id,
        tx_id: queued.tx_id,
        local_path: local.localPath,
        record_path: recordPath,
        store_path: store.path,
        seed_phrase: showSeed ? generated.seed_phrase : null,
        made_by_this_call: madeByThisCall,
        note:
          "the key was queued, not added. the human approves it in the web app with their wallet.",
      });
    } finally {
      store.db.close();
    }
  })();
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
