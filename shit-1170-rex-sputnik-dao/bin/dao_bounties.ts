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
  sputnik_dao_get_bounty_fun_json,
  sputnik_dao_get_bounties_fun_json,
  sputnik_dao_get_bounty_claims_fun_json,
} from "@near-kit-tool-box/fun";

import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
  shit_1170_sputnik_dao_id_fun,
} from "../src/chain";

// read a DAO's bounties.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.
//
// --- THE DECIMALS ARE NOT THE CONTRACT'S TO SAY ---
// a bounty amount is in the token's own smallest unit, and the
// contract does not say how many decimals that is. NEAR is 24 and
// most other tokens are 18, so read the decimals from the token
// registry — never from a guess. an empty `token_id` means NEAR.
//
// --- THE CLAIMS ---
// `get_bounty_claims` takes ONE argument, the account id. the
// contract ignores any other field.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dao_bounties --dao <name|account_id> [--from-index 0] [--limit 50] [--bounty-id <n>] [--claims <account_id>] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);
  const near = shit_1170_near_client_fun(network);

  const bountyId = args_number_fun(args, "bounty-id");
  const claimsAccount = args_string_fun(args, "claims");

  let bounties: unknown;
  if (bountyId !== undefined) {
    // one bounty. the arg is `id`, not `bounty_id` — the contract
    // panics with `missing field 'id'` for the other name.
    const bounty = await sputnik_dao_get_bounty_fun_json(near, daoId, bountyId);
    bounties = bounty
      ? [bounty]
      : { bountyId, found: false, note: "no bounty with that id on this dao" };
  } else {
    const fromIndex = args_number_fun(args, "from-index", 0) ?? 0;
    const limit = args_number_fun(args, "limit", 50) ?? 50;
    bounties = await sputnik_dao_get_bounties_fun_json(
      near,
      daoId,
      fromIndex,
      limit,
    );
  }

  const claims = claimsAccount
    ? await sputnik_dao_get_bounty_claims_fun_json(near, daoId, claimsAccount)
    : undefined;

  print_json_fun({
    ok: true,
    daoId,
    network,
    bounties,
    ...(claims ? { claimsAccount, claims } : {}),
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
