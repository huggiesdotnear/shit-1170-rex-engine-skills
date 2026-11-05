#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  SHIT_1170_VIEW_CALL_ERROR,
  shit_1170_account_fun,
  shit_1170_network_fun,
  shit_1170_view_fun,
} from "../src/chain";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";

// a probe that fails because the ARGUMENTS were wrong still proves
// the method exists: the contract resolved it and ran it.
//
// only a method the contract does not have at all — `MethodNotFound`
// or `MethodResolveError` — means the method is missing. the chain
// module says which it was.

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "check_contract --id <account_id> [--network mainnet|testnet] [--methods method_a,method_b]",
      ],
    });
    return;
  }

  const accountId = shit_1170_require_string_fun(args, "id");
  const network = shit_1170_network_fun(
    shit_1170_flag_string_fun(args, "network"),
  );

  const methods = shit_1170_flag_string_fun(args, "methods")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

  const methodChecks: Record<string, unknown> = {};
  for (const method of methods) {
    try {
      // the probe calls the method with EMPTY arguments. for a method
      // that needs arguments this fails — but the method still exists,
      // so the failure is reported next to `exists: true`.
      const result = await shit_1170_view_fun<unknown>(
        network,
        accountId,
        method,
      );
      methodChecks[method] = { exists: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missing =
        err instanceof SHIT_1170_VIEW_CALL_ERROR
          ? err.missing
          : /MethodNotFound|MethodResolveError/i.test(message);
      methodChecks[method] = {
        exists: !missing,
        error: message,
        reason: missing ? "method_not_found" : "call_failed",
      };
    }
  }

  let exists = true;
  let amountYocto: string | null = null;
  let codeHash: string | null = null;
  try {
    const account = await shit_1170_account_fun(network, accountId);
    amountYocto = account.amount;
    codeHash = account.codeHash;
  } catch {
    exists = false;
  }

  shit_1170_print_json_fun({
    ok: true,
    accountId,
    network,
    exists,
    amountYocto,
    codeHash,
    methods: methodChecks,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
