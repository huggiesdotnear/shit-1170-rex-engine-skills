#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";
import {
  shit_1170_queue_record_get_fun,
  shit_1170_queue_records_list_fun,
} from "../src/local_queue";
import { shit_1170_swap_get_fun, shit_1170_tx_get_fun } from "../src/engine";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  const command = args.positional[0] ?? "help";

  if (command === "list") {
    const records = await shit_1170_queue_records_list_fun();
    shit_1170_print_json_fun({ ok: true, records });
    return;
  }

  if (command === "tx") {
    const id = shit_1170_require_string_fun(args, "id");
    const result = await shit_1170_tx_get_fun(id, {
      baseUrl: shit_1170_flag_string_fun(args, "base-url"),
    });
    shit_1170_print_json_fun({ ok: true, queue: result });
    return;
  }

  if (command === "swap") {
    const id = shit_1170_require_string_fun(args, "id");
    const result = await shit_1170_swap_get_fun(id, {
      baseUrl: shit_1170_flag_string_fun(args, "base-url"),
    });
    shit_1170_print_json_fun({ ok: true, swap: result });
    return;
  }

  if (command === "local") {
    const kind = shit_1170_require_string_fun(args, "kind");
    if (kind !== "tx" && kind !== "swap") {
      throw new Error("--kind must be tx or swap");
    }
    const id = shit_1170_require_string_fun(args, "id");
    const record = await shit_1170_queue_record_get_fun(kind, id);
    if (!record) throw new Error(`no local record for ${kind} ${id}`);
    shit_1170_print_json_fun({ ok: true, record });
    return;
  }

  if (command === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "get_queue list",
        "get_queue tx --id <queue_id>",
        "get_queue swap --id <swap_id>",
        "get_queue local --kind tx|swap --id <id>",
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
