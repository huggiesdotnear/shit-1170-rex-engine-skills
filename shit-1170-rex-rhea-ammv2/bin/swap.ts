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
  shit_1170_rhea_ammv2_return_fun,
} from "../src/chain";
import { shit_1170_rhea_ammv2_swap_queue_call_fun } from "../src/queue";

// prepare a swap queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- THE SWAP IS A LIST OF ACTIONS ---
// `swap` takes an ordered list of actions, each one a hop through a
// pool:
//
//   { pool_id, token_in, amount_in, token_out, min_amount_out }
//
// `amount_in` is OPTIONAL — when it is absent the contract reads the
// action as "swap every available balance of `token_in` I hold on the
// DEX, up to `min_amount_out`".
//
// `min_amount_out` is the slippage guard, in `token_out`'s smallest
// unit. the bin quotes each hop with `get_return` and applies the
// tolerance, so the floor is derived from the chain and not guessed.
//
// --- A MULTI-HOP SWAP ---
// `--pool-id` and `--token-in` take comma separated lists, one entry
// per hop. two hops means three tokens: in, middle, out.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "swap --pool-id <n[,n,...]> --token-in <token_id[,token_id,...]> --amount <unit_amount> --token-out <token_id> [--slippage 0.5] [--referral-id <account_id>] [--network mainnet|testnet]",
        "--slippage is a percentage, 0.5 means half a percent",
        "a multi-hop swap lists one pool and one token_in per hop",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_ammv2_id_fun(network);

  const poolIds = (args_string_fun(args, "pool-id") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!poolIds.length) throw new Error("--pool-id <n> is required");

  const tokensIn = (args_string_fun(args, "token-in") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!tokensIn.length) throw new Error("--token-in <token_id> is required");

  const tokenOut = args_string_fun(args, "token-out");
  if (!tokenOut) throw new Error("--token-out <token_id> is required");

  const amount = args_string_fun(args, "amount");
  if (!amount) throw new Error("--amount <unit_amount> is required");

  // one hop uses the same token list length as the pool list.
  if (tokensIn.length !== poolIds.length) {
    throw new Error(
      `--token-in and --pool-id must have the same number of entries — ${tokensIn.length} token(s) against ${poolIds.length} pool(s)`,
    );
  }

  const slippagePercent = Number(args_string_fun(args, "slippage") ?? "0.5");
  if (!Number.isFinite(slippagePercent) || slippagePercent < 0) {
    throw new Error("--slippage must be a number, 0.5 means half a percent");
  }

  // the hops, each one quoted from the chain.
  const factor = BigInt(Math.round((1 - slippagePercent / 100) * 1_000_000));
  const actions: {
    pool_id: number;
    token_in: string;
    amount_in?: string;
    token_out: string;
    min_amount_out: string;
  }[] = [];
  const quotes: unknown[] = [];

  let runningAmount = amount;
  for (let i = 0; i < poolIds.length; i++) {
    const poolId = Number(poolIds[i]);
    if (!Number.isInteger(poolId)) {
      throw new Error(`pool id ${poolIds[i]} is not a number`);
    }
    const tokenIn = tokensIn[i];
    // the token out of this hop is the token in of the next one.
    const tokenOutForHop = i + 1 < poolIds.length ? tokensIn[i + 1] : tokenOut;

    const quoted = await shit_1170_rhea_ammv2_return_fun(
      network,
      dclId,
      poolId,
      tokenIn,
      runningAmount,
      tokenOutForHop,
    );
    const minAmountOut = ((BigInt(quoted || "0") * factor) / 1_000_000n).toString();

    actions.push({
      pool_id: poolId,
      token_in: tokenIn,
      amount_in: runningAmount,
      token_out: tokenOutForHop,
      min_amount_out: minAmountOut,
    });
    quotes.push({
      pool_id: poolId,
      token_in: tokenIn,
      amount_in: runningAmount,
      token_out: tokenOutForHop,
      quotedOutput: quoted,
      min_amount_out: minAmountOut,
    });

    // the next hop takes what this one produced.
    runningAmount = quoted;
  }

  const transaction = shit_1170_rhea_ammv2_swap_queue_call_fun({
    dclId,
    actions,
    referral_id: args_string_fun(args, "referral-id"),
    ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
  });

  print_json_fun({
    ok: true,
    queueAction: "queue_swap",
    dclId,
    network,
    amountIn: amount,
    tokenOut,
    hops: actions.length,
    actions,
    quotes,
    slippagePercent,
    // the swap takes the tokens straight from the wallet — the
    // deposited balance is not involved.
    usesDepositedBalance: false,
    warnings: [],
    transactions: [transaction],
    transaction,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
