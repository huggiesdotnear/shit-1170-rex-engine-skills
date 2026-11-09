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
  shit_1170_rhea_ammv2_pool_fun,
  shit_1170_rhea_ammv2_pool_shares_fun,
} from "../src/chain";
import { shit_1170_view_fun } from "../src/chain";

// read an account's LP positions on one pool.
//
// --- WHY THIS IS SEPARATE FROM THE DEPOSITED BALANCE ---
// the two are different things and are easy to confuse:
//
//   the DEPOSITED BALANCE is tokens the account parked at the DEX.
//   `get_deposits` lists them, and `withdraw` pays them out.
//
//   the LP POSITION is the account's share of a pool's reserves. it is
//   NOT deposited tokens, and it is NOT in the deposited balance.
//
// this bin reads the LP position.
//
// --- THERE IS NO POSITION LIST ---
// the AMM v2 contract has NO view that lists an account's LP
// positions. there is no "my positions" method. to find out what an
// account holds in a pool you must already know the pool id, and
// then ask:
//
//   get_pool_shares(pool_id, account_id)   -> a bare share string
//
// the shares alone do not say what they are worth. the token amounts
// behind them come from:
//
//   get_unit_share_token_amounts(pool_id)  -> what ONE share is worth
//
// and the position's value is that multiplied by the shares.
//
// the concentrated-liquidity DEX is different — `list_liquidities`
// there DOES list an account's positions as full objects. this is the
// AMM, and it has no such list.
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
        "positions --pool-id <n> --account <account_id> [--network mainnet|testnet]",
        "positions --pool-id <n> --account <account_id> --all-pools",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_ammv2_id_fun(network);
  const account = args_string_fun(args, "account");
  if (!account) throw new Error("--account <account_id> is required");
  const poolId = args_number_fun(args, "pool-id");
  if (poolId === undefined) throw new Error("--pool-id <n> is required");

  const pool = await shit_1170_rhea_ammv2_pool_fun(network, dclId, poolId);
  const shares = await shit_1170_rhea_ammv2_pool_shares_fun(
    network,
    dclId,
    poolId,
    account,
  );

  // what one share is worth, per token. the position's token amounts
  // are this times the shares.
  let unitShare: string[] | null = null;
  try {
    const result = await shit_1170_view_fun<string[]>(
      network,
      dclId,
      "get_unit_share_token_amounts",
      { pool_id: poolId },
    );
    unitShare = result ?? null;
  } catch {
    // a pool kind that does not answer it. the shares still stand.
    unitShare = null;
  }

  // the position's token amounts.
  const amounts: string[] | null = unitShare
    ? unitShare.map((unit) => {
        const one = BigInt(unit || "0");
        const held = BigInt(shares || "0");
        return (one * held).toString();
      })
    : null;

  const shareValue = BigInt(shares || "0") > 0n;

  print_json_fun({
    ok: true,
    dclId,
    network,
    account,
    poolId,
    pool: {
      pool_kind: pool.pool_kind,
      token_account_ids: pool.token_account_ids,
      amounts: pool.amounts,
      total_fee: pool.total_fee,
      shares_total_supply: pool.shares_total_supply,
    },
    // the account's shares in this pool, as a bare decimal string.
    shares,
    // what one share is worth, per token, in the pool's token order.
    unitShareTokenAmounts: unitShare,
    // the position's token amounts, in the pool's token order — the
    // shares multiplied by the unit share.
    positionTokenAmounts: amounts,
    // the account holds a position in this pool.
    hasPosition: shareValue,
    warnings: shareValue
      ? []
      : [
          "this account holds no shares in this pool — there is no position to withdraw",
        ],
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
