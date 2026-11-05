#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
  shit_1170_quiet_fun,
} from "../src/json_io";

const SHIT_1170_TX_BASE_URLS = {
  mainnet: "https://tx.main.fastnear.com",
  testnet: "https://tx.test.fastnear.com",
} as const;

type SHIT_1170_TX_NETWORK = keyof typeof SHIT_1170_TX_BASE_URLS;

function parse_network_fun(value: string): SHIT_1170_TX_NETWORK {
  if (value !== "mainnet" && value !== "testnet") {
    throw new Error(`--network must be mainnet or testnet, got "${value}"`);
  }
  return value;
}

function as_record_fun(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * the FastNear API names its request fields in snake_case;
 * `txHashes` is answered with a 400 "missing field `tx_hashes`".
 */
function build_body_fun(
  txHash: string,
  signer?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { tx_hashes: [txHash] };
  if (signer) body.sender_account_id = signer;
  return body;
}

/**
 * the transaction's success/failure state lives in
 * `execution_outcome.outcome.status`, a Rust enum serialized as
 * `{"SuccessReceiptId": "..."}`, `{"SuccessValue": "..."}` or
 * `{"Failure": {...}}`.
 */
function read_outcome_status_fun(outcome: unknown): string | null {
  const record = as_record_fun(outcome);
  if (!record) return null;
  const status = as_record_fun(record.status);
  if (!status) return null;
  for (const key of Object.keys(status)) {
    if (key === "SuccessReceiptId" || key === "SuccessValue") return "succeeded";
    if (key === "Failure") return "failed";
  }
  return null;
}

/**
 * a transaction can succeed while one of its receipts fails. the
 * engine's `succeeded`/`failed` statuses mean "did the work happen",
 * so a failed receipt counts as a failure.
 */
function read_receipts_failed_fun(transaction: unknown): boolean {
  const record = as_record_fun(transaction);
  if (!record) return false;
  const receipts = record.receipts;
  if (!Array.isArray(receipts)) return false;
  for (const receipt of receipts) {
    const receipt_record = as_record_fun(receipt);
    if (!receipt_record) continue;
    const execution = as_record_fun(receipt_record.execution_outcome);
    if (!execution) continue;
    const status = read_outcome_status_fun(execution.outcome);
    if (status === "failed") return true;
  }
  return false;
}

function read_status_fun(transaction: unknown): string | null {
  const record = as_record_fun(transaction);
  if (!record) return null;
  const execution = as_record_fun(record.execution_outcome);
  if (execution) {
    const status = read_outcome_status_fun(execution.outcome);
    if (status === "failed") return "failed";
    if (status === "succeeded") {
      return read_receipts_failed_fun(transaction) ? "failed" : "succeeded";
    }
  }
  if (typeof record.success === "boolean") {
    return record.success ? "succeeded" : "failed";
  }
  if (typeof record.status === "string" && record.status.trim().length > 0) {
    return record.status;
  }
  return null;
}

function extract_transaction_fun(payload: unknown): unknown {
  const record = as_record_fun(payload);
  if (!record) return payload;
  if (record.transaction !== undefined) return record.transaction;
  const transactions = record.transactions;
  if (Array.isArray(transactions) && transactions.length > 0) {
    return transactions[0];
  }
  return payload;
}

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "tx_status --tx-hash <hash> [--signer <account_id>] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const txHash = shit_1170_require_string_fun(args, "tx-hash");
  const signer = shit_1170_flag_string_fun(args, "signer");
  const network = parse_network_fun(
    shit_1170_flag_string_fun(args, "network") ?? "mainnet",
  );
  const baseUrl = SHIT_1170_TX_BASE_URLS[network];

  // stdout must stay pure json. `shit_1170_quiet_fun` moves any
  // stray console.log to stderr for the length of the call.
  const { response, text } = await shit_1170_quiet_fun(async () => {
    const response = await fetch(`${baseUrl}/v0/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(build_body_fun(txHash, signer)),
    });
    return { response, text: await response.text() };
  });
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const record = as_record_fun(payload);
    const message = record
      ? String(record.message ?? record.error ?? text)
      : String(text);
    if (!signer && response.status === 400 && /sender|account/i.test(message)) {
      throw new Error(
        `the FastNear transactions API rejected the request: ${message}. pass --signer <account_id> (the signer account id) and try again`,
      );
    }
    throw new Error(
      `the FastNear transactions API returned ${response.status}: ${message}`,
    );
  }

  const transaction = extract_transaction_fun(payload);
  const status = read_status_fun(transaction) ?? read_status_fun(payload);

  if (status === null) {
    throw new Error(
      `the FastNear transactions API found no transaction for ${txHash} on ${network}; the hash may be wrong, or the transaction may not be indexed yet`,
    );
  }

  shit_1170_print_json_fun({
    ok: true,
    txHash,
    status,
    transaction,
  });
}

main_fun()
  .catch((err) => {
    shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
