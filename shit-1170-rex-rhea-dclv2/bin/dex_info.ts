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
  shit_1170_rhea_dclv2_aligned_points_fun,
  shit_1170_rhea_dclv2_id_fun,
  shit_1170_rhea_dclv2_metadata_fun,
  shit_1170_rhea_dclv2_pool_fun,
  shit_1170_rhea_dclv2_pools_fun,
  shit_1170_rhea_dclv2_point_delta_fun,
} from "../src/chain";

// read the DEX — its metadata, its pools, or one pool.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.
//
// --- THE POOL ID ---
// a pool id is a composite STRING, not a number:
//
//   <token_x_account_id>|<token_y_account_id>|<fee>
//
// both segments are the tokens' NEAR account ids and the fee is in
// basis points. the tokens are sorted in the pool id.
//
// --- THE POINTS ---
// the pool's `point_delta` comes from its fee: 100→1, 400→8,
// 2000→40, 10000→200. an LP range must sit on multiples of it, else
// the call fails with `E200: invalid endpoint`.
//
// `current_point` is generally NOT a multiple of `point_delta`, so
// the aligned edges around it are reported too.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "list-pools"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dex_info [--network mainnet|testnet]",
        "dex_info --pool-id <token_x|token_y|fee> [--network mainnet|testnet]",
        "dex_info --list-pools [--from-index 0] [--limit 50] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);

  const poolId = args_string_fun(args, "pool-id");
  const listPools = args_bool_fun(args, "list-pools");

  if (poolId) {
    const pool = await shit_1170_rhea_dclv2_pool_fun(network, dclId, poolId);
    const delta = pool.point_delta ?? shit_1170_rhea_dclv2_point_delta_fun(pool.fee);
    const aligned =
      pool.current_point !== undefined
        ? shit_1170_rhea_dclv2_aligned_points_fun(pool.current_point, delta)
        : null;
    print_json_fun({
      ok: true,
      dclId,
      network,
      pool,
      // the point delta this pool uses, and the aligned edges around
      // its current point — the edges an LP range must sit on.
      pointDelta: delta,
      alignedPoints: aligned,
    });
    return;
  }

  if (listPools) {
    const fromIndex = args_number_fun(args, "from-index", 0) ?? 0;
    const limit = args_number_fun(args, "limit", 50) ?? 50;
    const pools = await shit_1170_rhea_dclv2_pools_fun(
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
      pools: pools.map((pool) => ({
        pool_id: pool.pool_id,
        token_x: pool.token_x,
        token_y: pool.token_y,
        fee: pool.fee,
        point_delta: pool.point_delta,
        current_point: pool.current_point,
        liquidity: pool.liquidity,
        state: pool.state,
      })),
    });
    return;
  }

  const metadata = await shit_1170_rhea_dclv2_metadata_fun(network, dclId);
  print_json_fun({
    ok: true,
    dclId,
    network,
    metadata,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
