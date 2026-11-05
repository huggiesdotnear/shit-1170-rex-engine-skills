#!/usr/bin/env bun
import {
  greeting_contractid,
  greeting_get_greeting_fun_json,
} from "@near-kit-tool-box/fun";
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";
import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
} from "../src/chain";

import { shit_1170_queue_call_fun } from "../src/queue_payload";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  const command = args.positional[0] ?? "get";
  const network = shit_1170_network_fun(
    args_string_fun(args, "network"),
  );
  const contractId =
    args_string_fun(args, "contract") ??
    greeting_contractid(network);

  if (command === "get") {
    const greeting = await greeting_get_greeting_fun_json(
      shit_1170_near_client_fun(network),
      contractId,
    );
    print_json_fun({ ok: true, contractId, network, greeting });
    return;
  }

  if (command === "set") {
    const greeting = args_require_string_fun(args, "greeting");
    // the write is a QUEUE PAYLOAD, not a transaction. the engine
    // queues it and a human signs it.
    const transaction = shit_1170_queue_call_fun({
      contractId,
      method: "set_greeting",
      args: { greeting },
      gas: "3000000000000",
      deposit: "0",
    });
    print_json_fun({
      ok: true,
      action: "queue_set_greeting",
      transaction,
    });
    return;
  }

  if (command === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "greeting get [--network mainnet|testnet] [--contract id]",
        "greeting set --greeting <text> [--network mainnet|testnet] [--contract id]",
      ],
    });
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
