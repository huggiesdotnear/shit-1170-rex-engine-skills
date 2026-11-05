#!/usr/bin/env bun
import {
  greeting_get_greeting_fun_json,
  greeting_methods_const,
} from "@near-kit-tool-box/fun";
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../../shit-1170-rex-engine/src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../../shit-1170-rex-engine/src/json_io";
import { shit_1170_hello_contract_id_fun } from "../src/index";
import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
} from "../src/chain";
import { shit_1170_queue_call_fun } from "../src/queue_payload";

// read the greeting, or prepare the call that sets it.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// the `set` command does not queue anything and does not send
// anything. it prints the QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — which the engine
// queues for a HUMAN to sign in the web app with their wallet.
//
// the `get` command is a VIEW read. it changes nothing on the chain.

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  const command = args.positional[0] ?? "get";
  const network = shit_1170_network_fun(
    shit_1170_flag_string_fun(args, "network"),
  );
  const contractId =
    shit_1170_flag_string_fun(args, "contract") ??
    shit_1170_hello_contract_id_fun(network);

  if (command === "get") {
    const greeting = await greeting_get_greeting_fun_json(
      shit_1170_near_client_fun(network),
      contractId,
    );
    shit_1170_print_json_fun({ ok: true, contractId, network, greeting });
    return;
  }

  if (command === "set") {
    const greeting = shit_1170_require_string_fun(args, "greeting");
    // the write is a QUEUE PAYLOAD, not a transaction. the engine
    // queues it and a human signs it.
    const transaction = shit_1170_queue_call_fun({
      contractId,
      method: greeting_methods_const.set_greeting,
      args: { greeting },
      gas: "3000000000000",
      deposit: "0",
    });
    shit_1170_print_json_fun({
      ok: true,
      action: "queue_set_greeting",
      transaction,
    });
    return;
  }

  if (command === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
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
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
