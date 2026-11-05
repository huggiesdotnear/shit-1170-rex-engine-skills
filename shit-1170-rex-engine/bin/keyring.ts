#!/usr/bin/env bun
import {
  shit_1170_account_list_fun,
  shit_1170_account_remove_fun,
  shit_1170_account_set_fun,
  shit_1170_account_resolve_fun,
} from "../src/keyring";
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
  shit_1170_quiet_fun,
} from "../src/json_io";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  const command = args.positional[0] ?? "help";

  if (command === "set") {
    const profile = await shit_1170_account_set_fun(
      shit_1170_require_string_fun(args, "account"),
      shit_1170_require_string_fun(args, "api-key"),
      {
        baseUrl: shit_1170_flag_string_fun(args, "base-url"),
        label: shit_1170_flag_string_fun(args, "label"),
      },
    );
    shit_1170_print_json_fun({
      ok: true,
      accountId: profile.accountId,
      baseUrl: profile.baseUrl ?? null,
      label: profile.label ?? null,
    });
    return;
  }

  if (command === "list") {
    const profiles = await shit_1170_account_list_fun();
    shit_1170_print_json_fun({ ok: true, accounts: profiles });
    return;
  }

  if (command === "get") {
    const profile = await shit_1170_account_resolve_fun(
      shit_1170_flag_string_fun(args, "account"),
    );
    shit_1170_print_json_fun({
      ok: true,
      accountId: profile.accountId,
      baseUrl: profile.baseUrl ?? null,
      label: profile.label ?? null,
      hasApiKey: profile.apiKey.length > 0,
    });
    return;
  }

  if (command === "remove") {
    const removed = await shit_1170_account_remove_fun(
      shit_1170_require_string_fun(args, "account"),
    );
    shit_1170_print_json_fun({ ok: true, removed });
    return;
  }

  if (command === "whoami") {
    const profile = await shit_1170_account_resolve_fun(
      shit_1170_flag_string_fun(args, "account"),
    );
    const { shit_1170_api_key_me_fun } = await import("../src/engine");
    const result = await shit_1170_quiet_fun(() =>
      shit_1170_api_key_me_fun(profile.apiKey, {
        baseUrl: profile.baseUrl,
      }),
    );
    shit_1170_print_json_fun({ ok: true, ...result });
    return;
  }

  if (command === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "keyring set --account <id> --api-key <key> [--base-url <url>] [--label <text>]",
        "keyring list",
        "keyring get [--account <id>]",
        "keyring remove --account <id>",
        "keyring whoami [--account <id>]",
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
