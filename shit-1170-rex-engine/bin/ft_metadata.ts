#!/usr/bin/env bun
import {
  ft_metadata_fun_json,
  ft_total_supply_fun_json,
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
  shit_1170_view_fun,
} from "../src/chain";


// the NEP-145 storage bounds, as the token reports them.
interface SHIT_1170_STORAGE_BOUNDS {
  min: string;
  max: string | null;
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: ["ft_metadata --token <token_id> [--network mainnet|testnet]"],
    });
    return;
  }

  const token = args_require_string_fun(args, "token");
  const network = shit_1170_network_fun(
    args_string_fun(args, "network"),
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

  print_json_fun({
    ok: true,
    token,
    network,
    metadata,
    totalSupply,
    storageBalanceBounds,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
