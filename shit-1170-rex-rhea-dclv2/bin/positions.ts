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
  shit_1170_rhea_dclv2_id_fun,
  shit_1170_rhea_dclv2_liquidities_fun,
  shit_1170_rhea_dclv2_user_assets_fun,
} from "../src/chain";

// read an account's positions and its internal balance.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.
//
// --- THE TWO BALANCES ---
// the **internal balance** is what the DEX holds of an account's
// tokens. `add_liquidity` pulls from it and `withdraw_asset` pays out
// of it. it is separate from the account's wallet balance — a token in
// the internal balance is at the DEX, not in the account.
//
// the **positions** are the account's liquidity ranges. each has an
// `lpt_id` — the pool id plus the owner's liquidity index — and the
// `unclaimed_fee_x` / `unclaimed_fee_y` the position has accrued.
//
// **the fees are claimed by removing liquidity with an amount of
// `"0"`.** there is no `claim_fee` method. that removes no liquidity,
// so the position stays open, and the claimed fees go straight to the
// wallet.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "positions --account <account_id> [--from-index 0] [--limit 50] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);
  const account = args_string_fun(args, "account");
  if (!account) throw new Error("--account <account_id> is required");

  const fromIndex = args_number_fun(args, "from-index", 0) ?? 0;
  const limit = args_number_fun(args, "limit", 50) ?? 50;

  const [liquidities, assets] = await Promise.all([
    shit_1170_rhea_dclv2_liquidities_fun(
      network,
      dclId,
      account,
      fromIndex,
      limit,
    ),
    shit_1170_rhea_dclv2_user_assets_fun(network, dclId, account),
  ]);

  print_json_fun({
    ok: true,
    dclId,
    network,
    account,
    // the positions, with the fees that have accrued on them.
    positions: liquidities.map((position) => ({
      lpt_id: position.lpt_id,
      owner_id: position.owner_id,
      pool_id: position.pool_id,
      left_point: position.left_point,
      right_point: position.right_point,
      // the liquidity amount — this is what remove_liquidity takes,
      // NOT a token amount.
      amount: position.amount,
      unclaimed_fee_x: position.unclaimed_fee_x,
      unclaimed_fee_y: position.unclaimed_fee_y,
    })),
    // the internal balance, as a token -> amount map.
    internalBalance: assets,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
