#!/usr/bin/env bun
// ========================================
// UNIT_CONVERSION
// the agent friendly unit conversion bin.
//
// it takes a token's contract address and ONE amount, and answers with
// the amount in both forms: the human decimal amount ("1.5") and the
// chain's unit amount ("1500000000000000000000000").
//
// the amount's side is said EXPLICITLY with --decimal or --unit, never
// guessed: a guess that picks the wrong side produces a number that
// looks right and is wrong by a factor of 10**decimals, and that is
// the worst possible failure for an amount about to be transferred.
//
// argv:
//   bun bin/unit_conversion.ts --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]
//
// examples:
//   bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5
//   bun bin/unit_conversion.ts --ca wrap.near --unit 1500000000000000000000000
//   bun bin/unit_conversion.ts --ca usdt.tether-token.near --decimal 0.5
//   bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5 --decimals 24
//
// --- WHY --decimals EXISTS: it skips the api call when the caller
// already knows the token's decimals. it is still the token's real
// decimals or the answer is wrong, so the api is the default source.
//
// the output is JSON on stdout, so an agent can read it without
// parsing prose. errors are JSON on stderr with a non-zero exit code.
// ========================================

import {
  human_to_unit_fun,
  unit_to_human_fun,
  unit_to_raw_human_fun,
  unit_conversion_token_info_fun,
} from "../src/index";
// ========================================
// --- CONFIG -----------------------------
// the flags that take no value.
const BOOLEAN_FLAGS: string[] = [];

// the usage text, printed on a bad call.
//
// --- WHY IT MATCHES THE PYTHON BIN'S USAGE WORD FOR WORD: the two
// bins are two ways to run the same thing, and an agent that reads one
// of them should be able to hand the other the same command. a
// different usage text invites a mistake about which flags exist.
const USAGE = `usage: bun bin/unit_conversion.ts --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]

  --ca <id>        the token's contract address / account id (e.g. wrap.near)
  --decimal <amt>  the amount in human decimals (e.g. 1.5) -> unit amount
  --unit <amt>     the amount in the chain's smallest unit (e.g. 1500000000000000000000000) -> decimal amount
  --decimals <n>   the token's decimals, when they are already known (skips the api call)
  --help           show this message`;

// ========================================
// --- ARGV ------------------------------
// --- WHY A HAND ROLLED PARSER: the bin takes a handful of flags and
// must accept `--decimal 1.5` and `--decimal=1.5` alike, because an
// agent writing either should get the same answer.
interface ARGV {
  ca: string | null;
  decimal: string | null;
  unit: string | null;
  decimals: string | null;
  help: boolean;
}

function parse_argv_fun(argv: string[]): ARGV {
  const out: ARGV = {
    ca: null,
    decimal: null,
    unit: null,
    decimals: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;

    // the --flag=value form.
    const eq = token.indexOf("=");
    if (token.startsWith("--") && eq !== -1) {
      const name = token.slice(0, eq);
      const value = token.slice(eq + 1);
      if (name === "--ca") out.ca = value;
      else if (name === "--decimal") out.decimal = value;
      else if (name === "--unit") out.unit = value;
      else if (name === "--decimals") out.decimals = value;
      else {
        console.error(`unknown flag: ${name}`);
        process.exit(1);
      }
      continue;
    }

    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }

    if (BOOLEAN_FLAGS.includes(token)) continue;

    if (token === "--ca" || token === "--decimal" || token === "--unit" || token === "--decimals") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`${token} was passed without a value`);
        process.exit(1);
      }
      if (token === "--ca") out.ca = value;
      if (token === "--decimal") out.decimal = value;
      if (token === "--unit") out.unit = value;
      if (token === "--decimals") out.decimals = value;
      i++;
      continue;
    }

    console.error(`unexpected argument: ${token}`);
    process.exit(1);
  }

  return out;
}

// ========================================
// --- ERROR -----------------------------
// print a json error and leave with a non-zero code, so a caller can
// tell a failed call from a conversion with no result.
function fail_fun(message: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ ok: false, error: message, ...extra }, null, 2));
  process.exit(1);
}

// ========================================
// --- MAIN ------------------------------
async function main_fun(): Promise<void> {
  const args = parse_argv_fun(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.ca === null) {
    fail_fun("--ca is required: the token's contract address", { usage: USAGE });
  }

  // exactly one side. both is a contradiction the caller has to fix,
  // and neither means the caller did not say what the amount is.
  if (args.decimal !== null && args.unit !== null) {
    fail_fun(
      "give ONE of --decimal or --unit, not both — they are two views of the same amount",
    );
  }
  if (args.decimal === null && args.unit === null) {
    fail_fun("one of --decimal or --unit is required: which side is the amount?", {
      usage: USAGE,
    });
  }

  // the decimals: the caller's if they know them, else the api's.
  let decimals: number;
  let symbol: string | null = null;
  let source: "given" | "api" | "local" = "given";

  if (args.decimals !== null) {
    const parsed = Number(args.decimals);
    if (!Number.isInteger(parsed) || parsed < 0) {
      fail_fun(`--decimals must be a whole number, got "${args.decimals}"`);
    }
    decimals = parsed;
  } else {
    try {
      const info = await unit_conversion_token_info_fun(args.ca);
      decimals = info.decimals;
      symbol = info.symbol;
      // the source comes from the lookup, so the answer never claims
      // the api said something the api was never asked.
      source = info.source;
    } catch (err) {
      fail_fun(err instanceof Error ? err.message : String(err));
    }
  }

  const side = args.decimal !== null ? "decimal" : "unit";
  const amount = side === "decimal" ? (args.decimal as string) : (args.unit as string);

  let human: string;
  let unit: string;

  if (side === "decimal") {
    const converted = human_to_unit_fun(amount, decimals);
    if (converted === null) {
      fail_fun(
        `"${amount}" is not a plain decimal amount — use digits and one dot, no exponent and no sign`,
        { amount, side },
      );
    }
    unit = converted;
    human = amount.trim();
  } else {
    human = unit_to_human_fun(amount, decimals);
    if (human.length === 0) {
      fail_fun(
        `"${amount}" is not a unit amount — a unit amount is the token's smallest unit, a plain whole number with no dot`,
        { amount, side },
      );
    }
    unit = amount.trim();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        ca: args.ca,
        symbol,
        decimals,
        decimals_source: source,
        input: { side, amount },
        human,
        unit,
        // the human amount with every trailing zero kept, so the exact
        // figure the chain sees is never in doubt.
        human_exact: unit_to_raw_human_fun(unit, decimals),
      },
      null,
      2,
    ),
  );
}

// ========================================
await main_fun();
// ========================================
// copyright 2026 by sleet.near
