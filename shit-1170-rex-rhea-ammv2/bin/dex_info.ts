#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_network_fun,
  shit_1170_rhea_ammv2_id_fun,
  shit_1170_rhea_ammv2_metadata_fun,
  shit_1170_rhea_ammv2_number_of_pools_fun,
  shit_1170_rhea_ammv2_pool_fun,
  shit_1170_rhea_ammv2_pools_fun,
} from "../src/chain";

// read the DEX — its metadata, its pools, or one pool.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.
//
// --- THE POOL ---
// a pool answers with exactly six keys: `pool_kind`,
// `token_account_ids`, `amounts`, `total_fee`, `shares_total_supply`
// and `amp`.
//
// the pool kinds seen live are `SIMPLE_POOL`, `STABLE_SWAP`,
// `RATED_SWAP` and `DEGEN_SWAP`.
//
// the pool id is a NUMBER here, not a composite string — unlike the
// concentrated-liquidity DEX.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "list-pools"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dex_info [--network mainnet|testnet]",
        "dex_info --pool-id <n> [--network mainnet|testnet]",
        "dex_info --list-pools [--from-index 0] [--limit 50] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_ammv2_id_fun(network);

  const poolId = args_number_fun(args, "pool-id");
  if (poolId !== undefined) {
    const pool = await shit_1170_rhea_ammv2_pool_fun(network, dclId, poolId);
    print_json_fun({ ok: true, dclId, network, poolId, pool });
    return;
  }

  if (args_bool_fun(args, "list-pools")) {
    const fromIndex = args_number_fun(args, "from-index", 0) ?? 0;
    const limit = args_number_fun(args, "limit", 50) ?? 50;
    const pools = await shit_1170_rhea_ammv2_pools_fun(
      network,
      dclId,
      fromIndex,
      limit,
    );
    print_json_fun({
      ok: true,
      dclId,
      network,
      fromIndex,
      limit,
      pools: pools.map((pool, index) => ({
        // the index is the pool id when the page starts at zero.
        pool_id: fromIndex + index,
        pool_kind: pool.pool_kind,
        token_account_ids: pool.token_account_ids,
        amounts: pool.amounts,
        total_fee: pool.total_fee,
        shares_total_supply: pool.shares_total_supply,
      })),
    });
    return;
  }

  const [metadata, poolCount] = await Promise.all([
    shit_1170_rhea_ammv2_metadata_fun(network, dclId),
    shit_1170_rhea_ammv2_number_of_pools_fun(network, dclId),
  ]);
  print_json_fun({
    ok: true,
    dclId,
    network,
    metadata,
    poolCount,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
