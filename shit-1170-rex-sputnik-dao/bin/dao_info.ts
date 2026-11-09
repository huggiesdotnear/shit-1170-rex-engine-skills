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
  sputnik_dao_get_config_fun_json,
  sputnik_dao_get_factory_info_fun_json,
  sputnik_dao_get_available_amount_fun_json,
  sputnik_dao_get_locked_storage_amount_fun_json,
  sputnik_dao_version_fun_json,
} from "@near-kit-tool-box/fun";

import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
  shit_1170_sputnik_dao_id_fun,
} from "../src/chain";

// read a Sputnik DAO — its config, its balances, its version and the
// factory it belongs to.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.
//
// --- THE DAO IS NOT THE FACTORY ---
// `sputnik-dao.near` deploys the daos and lists them. it holds no
// dao state, and it answers none of the methods read here. calling
// the factory as if it were a dao fails with
// `MethodResolveError(MethodNotFound)`.
//
// a dao's account id is `<name>.sputnik-dao.near` on mainnet and
// `<name>.sputnikv2.testnet` on testnet. both the bare name and the
// full account id work.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dao_info --dao <name|account_id> [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);
  const near = shit_1170_near_client_fun(network);

  const [config, version, available, locked, factoryInfo] = await Promise.all([
    sputnik_dao_get_config_fun_json(near, daoId),
    sputnik_dao_version_fun_json(near, daoId),
    sputnik_dao_get_available_amount_fun_json(near, daoId),
    sputnik_dao_get_locked_storage_amount_fun_json(near, daoId),
    sputnik_dao_get_factory_info_fun_json(near, daoId),
  ]);

  print_json_fun({
    ok: true,
    daoId,
    network,
    name: config.name,
    purpose: config.purpose,
    // the metadata is base64-encoded JSON — the dao's own site
    // branding, e.g. `{ primaryColor, flagLogo }`.
    metadata: config.metadata,
    // the crate version of the build this dao runs. it is NOT the
    // factory's `[major, minor]` build number.
    version,
    // the NEAR the dao can spend, in yoctoNEAR. the balance minus the
    // protocol storage cost and the bonds locked in proposals and
    // bounties.
    availableAmount: available,
    // the protocol storage cost the dao's data occupies, in
    // yoctoNEAR. not the locked bond balance.
    lockedStorageAmount: locked,
    factoryInfo,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
