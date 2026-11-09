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
  shit_1170_rhea_dclv2_quote_fun,
} from "../src/chain";
import { shit_1170_rhea_dclv2_swap_queue_call_fun } from "../src/queue";

// prepare a swap queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- THE DEX HAS NO `swap` METHOD ---
// a swap is an `ft_transfer_call` on the **input token**, with the DEX
// as `receiver_id` and the swap carried inside `msg`. so the payload's
// `contractId` is the TOKEN, not the DEX.
//
// --- THE QUOTE AND THE SLIPPAGE ---
// `min_output_amount` is the floor the swap accepts. the bin quotes
// the swap first and applies the tolerance to the quoted output, so
// the floor is derived rather than guessed. `--min-output` overrides
// it.
//
// --- THE GAS ---
// a plain swap needs 180 Tgas. the 50 Tgas of the generic
// `ft_transfer_call` is not enough.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "swap --token-in <token_id> --amount <unit_amount> --pool-ids <pool_id_csv> --output-token <token_id> [--slippage 0.5] [--min-output <unit>] [--account <account_id>] [--network mainnet|testnet]",
        "--slippage is a percentage, 0.5 means half a percent",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);

  const tokenIn = args_string_fun(args, "token-in");
  if (!tokenIn) throw new Error("--token-in <token_id> is required");
  const amount = args_string_fun(args, "amount");
  if (!amount) throw new Error("--amount <unit_amount> is required");
  const outputToken = args_string_fun(args, "output-token");
  if (!outputToken) throw new Error("--output-token <token_id> is required");
  const poolIds = args_string_fun(args, "pool-ids")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!poolIds?.length) {
    throw new Error("--pool-ids <pool_id_csv> is required — the route through the pools");
  }

  // the floor. the bin quotes the swap and applies the tolerance, so
  // the number comes from the chain rather than from a guess.
  const minOutputOverride = args_string_fun(args, "min-output");
  const slippagePercent = Number(args_string_fun(args, "slippage") ?? "0.5");
  if (!Number.isFinite(slippagePercent) || slippagePercent < 0) {
    throw new Error("--slippage must be a number, 0.5 means half a percent");
  }

  const quote = await shit_1170_rhea_dclv2_quote_fun(
    network,
    dclId,
    poolIds,
    tokenIn,
    outputToken,
    amount,
  );

  let minOutput = minOutputOverride;
  if (!minOutput) {
    const quoted = BigInt(quote.amount || "0");
    // the tolerance is taken off the quoted output.
    const factor = BigInt(Math.round((1 - slippagePercent / 100) * 1_000_000));
    minOutput = ((quoted * factor) / 1_000_000n).toString();
  }

  const transaction = shit_1170_rhea_dclv2_swap_queue_call_fun({
    dclId,
    token_in_id: tokenIn,
    amount_in: amount,
    pool_ids: poolIds,
    output_token: outputToken,
    min_output_amount: minOutput,
    ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
  });

  print_json_fun({
    ok: true,
    queueAction: "queue_swap",
    dclId,
    network,
    tokenIn,
    outputToken,
    poolIds,
    amountIn: amount,
    // the quoted output and the floor derived from it.
    quotedOutput: quote.amount,
    slippagePercent,
    minOutputAmount: minOutput,
    // the swap goes straight in and straight out to the wallet — it
    // does NOT touch the internal balance.
    usesInternalBalance: false,
    warnings: quote.extra?.warnings
      ? [String(quote.extra.warnings)]
      : [],
    transactions: [transaction],
    transaction,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
