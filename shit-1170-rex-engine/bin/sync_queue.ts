#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";
import {
  shit_1170_queue_record_get_fun,
  shit_1170_queue_records_list_fun,
  shit_1170_queue_record_put_fun,
} from "../src/local_queue";
import { shit_1170_swap_get_fun, shit_1170_tx_get_fun } from "../src/engine";
import type { SHIT_1170_SYNC_RESULT } from "../src/types";

async function sync_one_fun(
  kind: "tx" | "swap",
  id: string,
  baseUrl?: string,
): Promise<SHIT_1170_SYNC_RESULT> {
  const before = await shit_1170_queue_record_get_fun(kind, id);
  const server = kind === "tx"
    ? ((await shit_1170_tx_get_fun(id, { baseUrl })) as unknown as Record<string, unknown>)
    : await shit_1170_swap_get_fun(id, { baseUrl });

  const changed = JSON.stringify(before?.response ?? null) !== JSON.stringify(server);
  if (before) {
    await shit_1170_queue_record_put_fun({
      kind,
      id,
      request: before.request,
      response: server,
    });
  }
  return { kind, id, changed, server };
}

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  const command = args.positional[0] ?? "help";
  const baseUrl = shit_1170_flag_string_fun(args, "base-url");

  if (command === "all") {
    const records = await shit_1170_queue_records_list_fun();
    const results: SHIT_1170_SYNC_RESULT[] = [];
    for (const record of records) {
      results.push(await sync_one_fun(record.kind, record.id, baseUrl));
    }
    shit_1170_print_json_fun({ ok: true, results });
    return;
  }

  if (command === "one") {
    const kind = args.positional[1];
    const id = args.positional[2];
    if ((kind !== "tx" && kind !== "swap") || !id) {
      throw new Error("usage: sync_queue one <tx|swap> <id>");
    }
    const result = await sync_one_fun(kind, id, baseUrl);
    shit_1170_print_json_fun({ ok: true, result });
    return;
  }

  if (command === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: ["sync_queue all", "sync_queue one <tx|swap> <id>"],
    });
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
