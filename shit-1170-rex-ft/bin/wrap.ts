#!/usr/bin/env bun
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_near_deposit_batch_fun,
  shit_1170_near_deposit_queue_call_fun,
  shit_1170_near_withdraw_queue_call_fun,
  shit_1170_wrap_near_contract_id_fun,
  shit_1170_wrap_near_storage_deposit_queue_call_fun,
} from "../src/index";
import {
  shit_1170_account_exists_fun,
  shit_1170_network_fun,
  shit_1170_storage_balance_of_fun,
  shit_1170_storage_minimum_balance_fun,
} from "../src/chain";
import {
  shit_1170_default_account_fun,
  shit_1170_stored_account_ids_fun,
} from "../src/accounts";

// prepare a wrap or an unwrap.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- WHY A WRAP IS NOT A SWAP ---
// the engine's swap queue names a token sold and a token bought, and
// a router works the route out at execution time. `near_deposit` and
// `near_withdraw` are direct calls to wrap.near, so a wrap is queued
// as a BATCH OF CALLS with the engine skill's `queue_tx.ts`.
//
// --- WHY THE REGISTRATION IS CONDITIONAL ---
// `near_deposit` mints wNEAR to the caller, and the contract needs
// somewhere to put the balance. an account with no NEP-145 storage
// registered on wrap.near cannot hold the mint, so the registration
// has to be in the batch, before the mint.
//
// but only an account that is NOT registered yet needs it. a second
// registration on a registered account wastes 0.00125 NEAR and a
// call, and the deposit stays on the contract.
//
// so the DEFAULT is to read the chain and include the registration
// only when the account is missing it. the read is a public view —
// `storage_balance_of` needs no key and no account.

const STORAGE_MODE_AUTO = "auto";
const STORAGE_MODE_YES = "yes";
const STORAGE_MODE_NO = "no";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-storage-deposit"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "wrap --direction wrap --amount <yoctoNEAR> [--gas tgas] [--storage-deposit yocto]",
        "wrap --direction unwrap --amount <wNEAR_unit> [--gas tgas]",
        "wrap --direction storage --storage-deposit yocto   # just the registration",
        "",
        "the amount is in the SMALLEST UNIT. native NEAR and wNEAR are both 24 decimals.",
        "",
        "the registration is CONDITIONAL and decided by the chain:",
        "  --with-storage-deposit auto   # the default. read the account, include only if missing",
        "  --with-storage-deposit yes    # force it in",
        "  --with-storage-deposit no     # force it out",
        "  --no-storage-deposit          # shorthand for the above 'no'",
        "",
        "--account <account_id> is the account the storage check reads.",
        "it defaults to the one stored account, and is needed only for the auto mode.",
      ],
    });
    return;
  }

  const direction = args_require_string_fun(args, "direction");
  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const contractId =
    args_string_fun(args, "contract") ?? shit_1170_wrap_near_contract_id_fun(network);
  const gas = args_string_fun(args, "gas");
  const amount = args_string_fun(args, "amount");
  const storageDeposit = args_string_fun(args, "storage-deposit");

  // the storage mode. `--no-storage-deposit` is the shorthand for
  // "no", and it wins over `--with-storage-deposit`.
  let storageMode: string = STORAGE_MODE_AUTO;
  if (args_bool_fun(args, "no-storage-deposit")) {
    storageMode = STORAGE_MODE_NO;
  }
  const storageModeFlag = args_string_fun(args, "with-storage-deposit");
  if (storageModeFlag !== undefined) {
    const value = storageModeFlag.trim().toLowerCase();
    if (value === "yes" || value === "true" || value === "force") {
      storageMode = STORAGE_MODE_YES;
    } else if (value === "no" || value === "false" || value === "skip") {
      storageMode = STORAGE_MODE_NO;
    } else if (value === STORAGE_MODE_AUTO) {
      storageMode = STORAGE_MODE_AUTO;
    } else {
      throw new Error(
        `--with-storage-deposit must be "auto", "yes", or "no", got "${storageModeFlag}"`,
      );
    }
  }

  if (direction === "storage") {
    print_json_fun({
      ok: true,
      action: "queue_wrap_near_storage_deposit",
      transactions: [
        shit_1170_wrap_near_storage_deposit_queue_call_fun({
          contractId,
          deposit: storageDeposit,
          gas,
        }),
      ],
    });
    return;
  }

  if (!amount) {
    throw new Error("--amount <smallest_unit> is required");
  }

  if (direction === "unwrap") {
    print_json_fun({
      ok: true,
      action: "queue_near_withdraw",
      direction: "unwrap",
      from: "wrap.near",
      to: "near",
      amount,
      transactions: [
        shit_1170_near_withdraw_queue_call_fun({
          amount,
          contractId,
          gas,
          deposit: args_string_fun(args, "deposit"),
        }),
      ],
    });
    return;
  }

  if (direction !== "wrap") {
    throw new Error(
      `--direction must be "wrap", "unwrap", or "storage", got "${direction}"`,
    );
  }

  // the wrap. the registration is decided by the chain unless it was
  // forced.
  let includeStorage: boolean;
  let storageReason: string;
  let account: string | undefined;
  let accountHasStorage: boolean | null = null;
  let storageMinimum: string | null = null;

  if (storageMode === STORAGE_MODE_YES) {
    includeStorage = true;
    storageReason = "forced with --with-storage-deposit";
  } else if (storageMode === STORAGE_MODE_NO) {
    includeStorage = false;
    storageReason = "forced with --no-storage-deposit";
  } else {
    // auto: read the account's registration.
    account = args_string_fun(args, "account") ?? undefined;
    if (!account) {
      account = (await shit_1170_default_account_fun()) ?? undefined;
    }
    if (!account) {
      const stored = await shit_1170_stored_account_ids_fun();
      throw new Error(
        stored.length > 1
          ? `more than one account is stored (${stored.join(", ")}); pass --account, or --with-storage-deposit or --no-storage-deposit to skip the read`
          : "--account <account_id> is required for the auto storage mode; pass --with-storage-deposit or --no-storage-deposit to skip the read",
      );
    }

    const exists = await shit_1170_account_exists_fun(network, account);
    if (!exists) {
      // an account that does not exist cannot be registered, and the
      // mint would fail anyway. say so rather than queueing a batch
      // that cannot run.
      throw new Error(
        `${account} does not exist on ${network}; the wrap would fail`,
      );
    }

    const balance = await shit_1170_storage_balance_of_fun(
      network,
      contractId,
      account,
    );
    accountHasStorage = balance.hasStorage;
    includeStorage = !balance.hasStorage;
    storageReason = balance.hasStorage
      ? `${account} is already registered on ${contractId}`
      : `${account} has no NEP-145 storage on ${contractId}`;

    // the contract's own minimum, so the registration attaches what
    // the contract actually wants.
    try {
      storageMinimum = await shit_1170_storage_minimum_balance_fun(
        network,
        contractId,
      );
    } catch {
      storageMinimum = null;
    }
  }

  const transactions = shit_1170_near_deposit_batch_fun({
    amount,
    contractId,
    gas,
    deposit: args_string_fun(args, "deposit"),
    storageDeposit: storageDeposit ?? storageMinimum ?? undefined,
    storageGas: args_string_fun(args, "storage-gas"),
    withStorageDeposit: includeStorage,
  });

  print_json_fun({
    ok: true,
    action: "queue_near_deposit",
    direction: "wrap",
    from: "near",
    to: "wrap.near",
    amount,
    account,
    accountHasStorage,
    storageMinimum,
    includesStorageDeposit: includeStorage,
    storageReason,
    transactions,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
