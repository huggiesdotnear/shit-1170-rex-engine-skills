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
  shit_1170_rhea_ammv2_return_fun,
  shit_1170_rhea_ammv2_storage_balance_of_fun,
  shit_1170_rhea_ammv2_storage_bounds_fun,
} from "../src/chain";

// check whether a DEX action will work, before it is queued.
//
// --- WHY THIS CHECK EXISTS ---
// three things make an AMM v2 call fail, and none of them are
// obvious:
//
// 1. **the account has no storage on the DEX.** the deposit and
//    withdrawal methods need NEP-145 storage registered.
//
// 2. **the pool does not hold the token.** a swap through a pool that
//    does not carry the token fails on the first hop. a pool's
//    `token_account_ids` says which tokens it holds.
//
// 3. **the DEX is not an FT holder of the token.** every token inflow
//    is an `ft_transfer_call` on the token into the DEX, and a token
//    contract refuses to transfer to a receiver it does not know —
//    the call panics with `The account <dex> is not registered` and
//    the tokens are refunded.
//
// this bin answers all three, and quotes the swap when asked.
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
        "dex_check --account <account_id> [--pool-id <n> --token-in <token_id> --token-out <token_id> --amount <unit>] [--token <token_id>]",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_ammv2_id_fun(network);
  const account = args_string_fun(args, "account");
  if (!account) throw new Error("--account <account_id> is required");

  const warnings: string[] = [];

  // 1. the account's storage on the DEX.
  const storage = await shit_1170_rhea_ammv2_storage_balance_of_fun(
    network,
    dclId,
    account,
  );
  if (!storage.hasStorage) {
    warnings.push(
      `${account} has no storage on the DEX; register with storage_deposit before depositing or withdrawing`,
    );
  }
  const bounds = await shit_1170_rhea_ammv2_storage_bounds_fun(network, dclId);

  // 2. the pool and the tokens it holds.
  const poolId = args_number_fun(args, "pool-id");
  const tokenIn = args_string_fun(args, "token-in");
  const tokenOut = args_string_fun(args, "token-out");
  const amount = args_string_fun(args, "amount");

  let pool: unknown = null;
  let quote: string | null = null;

  if (poolId !== undefined) {
    pool = await shit_1170_rhea_ammv2_pool_fun(network, dclId, poolId);
    const held = (pool as { token_account_ids?: string[] }).token_account_ids ?? [];
    if (tokenIn && !held.includes(tokenIn)) {
      warnings.push(
        `pool ${poolId} does not hold ${tokenIn} — it holds ${held.join(", ")}`,
      );
    }
    if (tokenOut && !held.includes(tokenOut)) {
      warnings.push(
        `pool ${poolId} does not hold ${tokenOut} — it holds ${held.join(", ")}`,
      );
    }
    if (tokenIn && tokenOut && amount) {
      quote = await shit_1170_rhea_ammv2_return_fun(
        network,
        dclId,
        poolId,
        tokenIn,
        amount,
        tokenOut,
      );
    }
  }

  // 3. the DEX's FT registration on the token.
  const token = args_string_fun(args, "token");
  let tokenRegistration: unknown = null;
  if (token) {
    try {
      const balance = await shit_1170_rhea_ammv2_storage_balance_of_fun(
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

  print_json_fun({
    ok: true,
    dclId,
    network,
    account,
    hasDexStorage: storage.hasStorage,
    storageTotal: storage.total,
    storageAvailable: storage.available,
    // the DEX's own storage bounds — the min and max in yoctoNEAR.
    storageBounds: bounds,
    poolId: poolId ?? null,
    pool,
    quote,
    tokenRegistration,
    warnings,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
