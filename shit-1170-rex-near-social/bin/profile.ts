#!/usr/bin/env bun
import {
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
} from "../src/bin_stuff";
import {
  shit_1170_social_check_writes_fun,
  shit_1170_social_profile_fields_fun,
  shit_1170_social_profile_queue_call_fun,
} from "../src/index";

// prepare a profile field.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// the write is a `__fastdata_kv` call on the `social` account, with
// the gas the standard states: `1`.
//
// --- THE FIELDS ---
//   --field name       profile/name        256 characters
//   --field about      profile/about      10000 characters
//   --field location   profile/location    256 characters
//   --field avatar     profile/avatar      a fastfs:// URI
//   --field banner     profile/banner      a fastfs:// URI
//   --service website  profile/links/website   2048 characters
//
// a link is a handle or an https:// url. `--service` takes any
// service name that matches ^[a-z0-9_]{1,32}$.
//
// --- CLEARING A FIELD ---
// `--clear` writes `null` instead of the value. that is a TOMBSTONE,
// not a delete: the old value stays in public history forever.
//
// --- SAY YOU ARE AUTOMATED ---
// the standard asks for it, and so does good manners: put it in
// `--field about`, and add a `--service website` link.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "clear", "fields"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "profile --account <account_id> --field <name|about|location|avatar|banner> --value <value>",
        "profile --account <account_id> --service <service> --value <handle-or-url>",
        "profile --account <account_id> --field <name> --clear   # write null — a tombstone",
        "profile --fields   # list the fields and their limits",
      ],
    });
    return;
  }

  if (args_bool_fun(args, "fields")) {
    const fields = shit_1170_social_profile_fields_fun();
    print_json_fun({
      ok: true,
      fields: Object.entries(fields).map(([name, entry]) => ({
        name,
        key: entry.key,
        maxLength: entry.max,
      })),
      links: {
        key: "profile/links/{service}",
        servicePattern: "^[a-z0-9_]{1,32}$",
        maxLength: 2048,
        maxLinks: 32,
      },
    });
    return;
  }

  const account = args_string_fun(args, "account");
  if (!account) {
    throw new Error(
      "--account <account_id> is required — the account that will sign the write",
    );
  }

  const field = args_string_fun(args, "field");
  const service = args_string_fun(args, "service");
  const value = args_string_fun(args, "value");
  const clear = args_bool_fun(args, "clear");

  if (!field && !service) {
    throw new Error("--field or --service is required");
  }
  if (field && service) {
    throw new Error("--field and --service are two different things — pass one");
  }
  if (!clear && value === undefined) {
    throw new Error("--value <value> is required, or --clear to empty the field");
  }

  const queueCall = shit_1170_social_profile_queue_call_fun({
    accountId: account,
    field,
    service,
    value: clear ? undefined : value,
    gas: args_string_fun(args, "gas"),
    deposit: args_string_fun(args, "deposit"),
  });

  const check = shit_1170_social_check_writes_fun(queueCall.args);
  if (check.problems.length > 0) {
    print_error_fun(
      `the payload breaks ${check.problems.length} rule(s) of the social-kv/1 standard, and the indexer DROPS what breaks them silently:\n${check.problems
        .map((problem) => `  - ${problem.rule}: ${problem.detail}`)
        .join("\n")}`,
    );
    process.exitCode = 2;
    return;
  }

  print_json_fun({
    ok: true,
    action: "queue_profile",
    clear,
    transactions: [queueCall],
    transaction: queueCall,
    keys: check.keys,
    bytes: check.bytes,
    willDo: clear
      ? `clear the ${field ?? service} field of ${account}`
      : `set the ${field ?? service} field of ${account}`,
    note: "the receipt of a social write FAILS with CodeDoesNotExist, because the `social` account has no contract. that is expected — the FastData indexer reads the transaction, not the receipt.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
