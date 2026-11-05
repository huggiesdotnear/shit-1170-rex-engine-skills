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
import { shit_1170_queue_call_fun } from "../src/queue_payload";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["force", "help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "ft_transfer --token <token_id> --receiver <account_id> --amount <unit_amount> [--force]",
      ],
    });
    return;
  }

  const token = args_require_string_fun(args, "token");
  const receiver = args_require_string_fun(args, "receiver");
  const amount = args_require_string_fun(args, "amount");
  const force = args_bool_fun(args, "force");
  const known = await shit_1170_contact_has_fun(receiver);

  if (!known && !force) {
    print_error_fun(
      `${receiver} is not on the contacts list; confirm the address with the human and use --force only after approval`,
    );
    process.exitCode = 2;
    return;
  }

  print_json_fun({
    ok: true,
    action: "queue_ft_transfer",
    // the write is a QUEUE PAYLOAD, not a transaction. the engine
    // queues it and a human signs it.
    transaction: shit_1170_queue_call_fun({
      contractId: token,
      method: "ft_transfer",
      args: { receiver_id: receiver, amount },
      gas: "30000000000000",
      deposit: "1",
    }),
    receiverOnContacts: known,
    forced: !known && force,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
