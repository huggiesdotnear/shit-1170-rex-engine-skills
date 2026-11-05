#!/usr/bin/env bun
import {
  ft_metadata_fun_json,
  ft_total_supply_fun_json,
} from "@near-kit-tool-box/fun";
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
  shit_1170_view_fun,
} from "../src/chain";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";

// the NEP-145 storage bounds, as the token reports them.
interface SHIT_1170_STORAGE_BOUNDS {
  min: string;
  max: string | null;
}

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: ["ft_metadata --token <token_id> [--network mainnet|testnet]"],
    });
    return;
  }

  const token = shit_1170_require_string_fun(args, "token");
  const network = shit_1170_network_fun(
    shit_1170_flag_string_fun(args, "network"),
  );

  const near = shit_1170_near_client_fun(network);

  const metadata = await ft_metadata_fun_json(near, token);
  const totalSupply = await ft_total_supply_fun_json(near, token);

  // the tool box has no helper for `storage_balance_bounds`, so it is
  // read as a generic view. the token's real minimum deposit matters
  // to the ft skill: a `storage_deposit` needs that exact amount.
  let storageBalanceBounds: SHIT_1170_STORAGE_BOUNDS | null = null;
  try {
    storageBalanceBounds = await shit_1170_view_fun<SHIT_1170_STORAGE_BOUNDS>(
      network,
      token,
      "storage_balance_bounds",
    );
  } catch {
    // not every token implements the storage standard. its absence is
    // an answer, not a failure.
    storageBalanceBounds = null;
  }

  shit_1170_print_json_fun({
    ok: true,
    token,
    network,
    metadata,
    totalSupply,
    storageBalanceBounds,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
