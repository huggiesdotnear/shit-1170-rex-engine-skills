#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_network_fun,
  shit_1170_rhea_dclv2_id_fun,
  shit_1170_rhea_dclv2_pool_fun,
  shit_1170_rhea_dclv2_point_aligned_fun,
  shit_1170_rhea_dclv2_point_delta_fun,
  shit_1170_rhea_dclv2_quote_fun,
  shit_1170_rhea_dclv2_storage_balance_of_fun,
  shit_1170_rhea_dclv2_storage_detail_fun,
  shit_1170_rhea_dclv2_storage_bounds_fun,
} from "../src/chain";

// check whether a DEX action will work, before it is queued.
//
// --- WHY THIS CHECK EXISTS ---
// four things make a DCL v2 call fail, and none of them are obvious:
//
// 1. **the account has no storage on the DEX.** the DEX charges per
//    liquidity and per order slot, so an account with no storage
//    registered cannot add liquidity or place an order. the bare
//    `storage_balance_bounds` minimum is not enough in practice —
//    the slots are charged on top of it.
//
// 2. **the range points are not aligned.** an LP range must sit on
//    multiples of the pool's `point_delta`, else the call fails with
//    `E200: invalid endpoint`. `current_point` is generally NOT a
//    multiple of `point_delta`, so the edges have to be rounded.
//
// 3. **the DEX is not an FT holder of the token.** every token inflow
//    is an `ft_transfer_call` on the token into the DEX, and a token
//    contract refuses to transfer to a receiver it does not know —
//    the call panics with `The account <dcl_id> is not registered`
//    and the tokens are refunded.
//
// 4. **the output token has no storage for the signer.** a swap can
//    succeed and deliver nothing, the same way an FT transfer can.
//
// this bin answers 1 and 2 from the DEX and 3 from the token, and
// quotes the swap when asked.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dex_check --account <account_id> [--pool-id <id> --left-point <n> --right-point <n>]",
        "dex_check --account <account_id> --token <token_id> [--pool-ids <csv> --output-token <id> --amount <unit>]",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);
  const account = args_string_fun(args, "account");
  if (!account) throw new Error("--account <account_id> is required");

  const warnings: string[] = [];

  // 1. the account's storage on the DEX.
  const storage = await shit_1170_rhea_dclv2_storage_balance_of_fun(
    network,
    dclId,
    account,
  );
  if (!storage.hasStorage) {
    warnings.push(
      `${account} has no storage on the DEX; add_liquidity and the limit order methods will fail — register with storage_deposit (0.5 NEAR)`,
    );
  }

  let storageDetail: unknown = null;
  try {
    storageDetail = await shit_1170_rhea_dclv2_storage_detail_fun(
      network,
      dclId,
      account,
    );
  } catch {
    // the detail view is a bonus, not a requirement.
  }

  const bounds = await shit_1170_rhea_dclv2_storage_bounds_fun(
    network,
    dclId,
  );

  // 2. the range points, when a pool and a range were given.
  const poolId = args_string_fun(args, "pool-id");
  const leftPoint = args_string_fun(args, "left-point");
  const rightPoint = args_string_fun(args, "right-point");
  let points: unknown = null;

  if (poolId) {
    const pool = await shit_1170_rhea_dclv2_pool_fun(network, dclId, poolId);
    const delta = pool.point_delta ?? shit_1170_rhea_dclv2_point_delta_fun(pool.fee);
    const pointCheck: {
      pointDelta: number;
      currentPoint: number | undefined;
      leftPoint: number | null;
      rightPoint: number | null;
      leftAligned: boolean | null;
      rightAligned: boolean | null;
    } = {
      pointDelta: delta,
      currentPoint: pool.current_point,
      leftPoint: null,
      rightPoint: null,
      leftAligned: null,
      rightAligned: null,
    };

    if (leftPoint !== undefined && rightPoint !== undefined) {
      const left = Number(leftPoint);
      const right = Number(rightPoint);
      pointCheck.leftPoint = left;
      pointCheck.rightPoint = right;
      pointCheck.leftAligned = shit_1170_rhea_dclv2_point_aligned_fun(left, delta);
      pointCheck.rightAligned = shit_1170_rhea_dclv2_point_aligned_fun(right, delta);

      if (!pointCheck.leftAligned || !pointCheck.rightAligned) {
        warnings.push(
          `the range points must be multiples of the pool's point_delta (${delta}) — else the call fails with E200: invalid endpoint`,
        );
      }
      if (right <= left) {
        warnings.push("right_point must be greater than left_point");
      }
      if (
        pool.current_point !== undefined &&
        left > pool.current_point &&
        right > pool.current_point
      ) {
        warnings.push(
          "the whole range is above current_point, so it only consumes amount_x — pass amount_y as 0",
        );
      }
      if (
        pool.current_point !== undefined &&
        left < pool.current_point &&
        right < pool.current_point
      ) {
        warnings.push(
          "the whole range is below current_point, so it only consumes amount_y — pass amount_x as 0",
        );
      }
    }
    points = pointCheck;
  }

  // 3. the DEX's FT registration on the token.
  const token = args_string_fun(args, "token");
  let tokenRegistration: unknown = null;
  if (token) {
    try {
      const balance = await shit_1170_rhea_dclv2_storage_balance_of_fun(
        network,
        token,
        dclId,
      );
      tokenRegistration = { registered: balance.hasStorage };
      if (!balance.hasStorage) {
        warnings.push(
          `the DEX is not an FT holder of ${token} — the inflow will panic with "The account ${dclId} is not registered" and the tokens are refunded`,
        );
      }
    } catch (error) {
      tokenRegistration = { registered: null };
      warnings.push(
        `the token's storage registration for the DEX could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 4. the quote, when a route was given.
  const poolIds = args_string_fun(args, "pool-ids")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const outputToken = args_string_fun(args, "output-token");
  const amount = args_string_fun(args, "amount");
  let quote: unknown = null;

  if (poolIds?.length && outputToken && amount) {
    const result = await shit_1170_rhea_dclv2_quote_fun(
      network,
      dclId,
      poolIds,
      token ?? poolIds[0].split("|")[0],
      outputToken,
      amount,
    );
    quote = result;
  }

  print_json_fun({
    ok: true,
    dclId,
    network,
    account,
    // the account's storage on the DEX.
    hasDexStorage: storage.hasStorage,
    storageTotal: storage.total,
    storageAvailable: storage.available,
    // the DEX's own storage bounds — the min and max registration in
    // yoctoNEAR.
    storageBounds: bounds,
    storageDetail,
    points,
    tokenRegistration,
    quote,
    warnings,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
