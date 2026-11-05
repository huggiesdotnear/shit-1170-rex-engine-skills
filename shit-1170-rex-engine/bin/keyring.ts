#!/usr/bin/env bun
import {
  shit_1170_account_list_fun,
  shit_1170_account_remove_fun,
  shit_1170_account_set_fun,
  shit_1170_account_resolve_fun,
} from "../src/keyring";
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
  quiet_fun,
} from "@huggies/shit-1170-rex-engine-middleman";


async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  const command = args.positional[0] ?? "help";

  if (command === "set") {
    const profile = await shit_1170_account_set_fun(
      args_require_string_fun(args, "account"),
      args_require_string_fun(args, "api-key"),
      {
        baseUrl: args_string_fun(args, "base-url"),
        label: args_string_fun(args, "label"),
      },
    );
    print_json_fun({
      ok: true,
      accountId: profile.accountId,
      baseUrl: profile.baseUrl ?? null,
      label: profile.label ?? null,
    });
    return;
  }

  if (command === "list") {
    const profiles = await shit_1170_account_list_fun();
    print_json_fun({ ok: true, accounts: profiles });
    return;
  }

  if (command === "get") {
    const profile = await shit_1170_account_resolve_fun(
      args_string_fun(args, "account"),
    );
    print_json_fun({
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
      args_require_string_fun(args, "account"),
    );
    print_json_fun({ ok: true, removed });
    return;
  }

  if (command === "whoami") {
    const profile = await shit_1170_account_resolve_fun(
      args_string_fun(args, "account"),
    );
    const { shit_1170_api_key_me_fun } = await import("../src/engine");
    const result = await quiet_fun(() =>
      shit_1170_api_key_me_fun(profile.apiKey, {
        baseUrl: profile.baseUrl,
      }),
    );
    print_json_fun({ ok: true, ...result });
    return;
  }

  if (command === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
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
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
