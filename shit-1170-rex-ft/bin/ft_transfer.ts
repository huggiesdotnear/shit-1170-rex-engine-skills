#!/usr/bin/env bun
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_contact_has_fun } from "../src/contacts";
import {
  shit_1170_ft_transfer_call_queue_call_fun,
  shit_1170_ft_transfer_queue_call_fun,
  shit_1170_storage_deposit_queue_call_fun,
} from "../src/index";

// prepare an ft_transfer.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- WHY THE CONTACT CHECK IS HERE ---
// a mistyped NEAR account id is usually a valid account id that
// belongs to somebody else, and the transfer succeeds. the contact
// list is the deliberate act: an account id the human has read and
// agreed to. --force is not a warning silencer; it says a human
// looked at the address and said yes.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["force", "help", "with-storage-deposit"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "ft_transfer --token <token_id> --receiver <account_id> --amount <unit_amount> [--memo text] [--gas tgas] [--deposit yocto]",
        "ft_transfer --token <token_id> --receiver <account_id> --amount <unit_amount> --msg <json> [--memo text]",
        "ft_transfer ... --with-storage-deposit   # prepend a storage_deposit to the batch",
      ],
    });
    return;
  }

  const token = args_require_string_fun(args, "token");
  const receiver = args_require_string_fun(args, "receiver");
  const amount = args_require_string_fun(args, "amount");
  const force = args_bool_fun(args, "force");
  const msg = args_string_fun(args, "msg");

  const known = await shit_1170_contact_has_fun(receiver);
  if (!known && !force) {
    print_error_fun(
      `${receiver} is not on the contacts list; confirm the address with the human and use --force only after approval`,
    );
    process.exitCode = 2;
    return;
  }

  // the write is a QUEUE PAYLOAD, not a transaction. the engine
  // queues it and a human signs it.
  const queueCall = msg
    ? shit_1170_ft_transfer_call_queue_call_fun({
        tokenId: token,
        receiverId: receiver,
        amount,
        msg,
        memo: args_string_fun(args, "memo"),
        gas: args_string_fun(args, "gas"),
        deposit: args_string_fun(args, "deposit"),
      })
    : shit_1170_ft_transfer_queue_call_fun({
        tokenId: token,
        receiverId: receiver,
        amount,
        memo: args_string_fun(args, "memo"),
        gas: args_string_fun(args, "gas"),
        deposit: args_string_fun(args, "deposit"),
      });

  // the storage trap. when the receiver has no storage on the token,
  // the deposit has to land before the transfer delivers anything.
  const queueCalls = [queueCall];
  if (args_bool_fun(args, "with-storage-deposit")) {
    queueCalls.unshift(
      shit_1170_storage_deposit_queue_call_fun({
        tokenId: token,
        deposit: args_string_fun(args, "storage-deposit"),
        gas: args_string_fun(args, "storage-gas"),
      }),
    );
  }

  print_json_fun({
    ok: true,
    action: "queue_ft_transfer",
    transactions: queueCalls,
    transaction: queueCall,
    receiverOnContacts: known,
    forced: !known && force,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
