#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import {
  api_shit_1170_swap_queue_sent_post,
  api_shit_1170_tx_queue_sent_post,
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
  quiet_fun,
  type SHIT_1170_TX_QUEUE_HASH_REQUEST,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_account_resolve_fun } from "../src/keyring";
import {
  shit_1170_base_url_fun,
  shit_1170_swap_hash_fun,
  shit_1170_tx_hashes_fun,
} from "../src/engine";
import {
  shit_1170_queue_record_get_fun,
  shit_1170_queue_record_put_fun,
} from "../src/local_queue";


const SHIT_1170_CLIENT_STATUSES = ["succeeded", "failed"] as const;
type SHIT_1170_CLIENT_STATUS = (typeof SHIT_1170_CLIENT_STATUSES)[number];

function parse_status_fun(raw: string): SHIT_1170_CLIENT_STATUS {
  if (
    !(SHIT_1170_CLIENT_STATUSES as readonly string[]).includes(raw)
  ) {
    throw new Error(
      `--status must be one of ${SHIT_1170_CLIENT_STATUSES.join(", ")}; omit it to record "sent"`,
    );
  }
  return raw as SHIT_1170_CLIENT_STATUS;
}

function validate_hashes_fun(
  value: unknown,
): SHIT_1170_TX_QUEUE_HASH_REQUEST[] {
  if (!Array.isArray(value)) {
    throw new Error("the hashes file must hold a JSON array of hash entries");
  }
  return value.map((entry, index) => {
    const where = `the hashes file entry at index ${index}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${where} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const txId = record.txId;
    if (typeof txId !== "string" || txId.trim().length === 0) {
      throw new Error(`${where} must have a non-empty string "txId"`);
    }
    const txHash = record.txHash;
    if (typeof txHash !== "string" || txHash.trim().length === 0) {
      throw new Error(`${where} must have a non-empty string "txHash"`);
    }
    const status = record.status;
    if (
      status !== undefined &&
      status !== null &&
      !(
        typeof status === "string" &&
        (SHIT_1170_CLIENT_STATUSES as readonly string[]).includes(status)
      )
    ) {
      throw new Error(
        `${where} has an invalid "status"; it must be "succeeded" or "failed"`,
      );
    }
    const out: SHIT_1170_TX_QUEUE_HASH_REQUEST = { txId, txHash };
    if (typeof status === "string") out.status = status as SHIT_1170_CLIENT_STATUS;
    return out;
  });
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["from-server", "help"],
  });
  const command = args.positional[0] ?? "help";
  if (command === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "queue_sent tx --queue <id> (--from-server | --hashes <tx-hashes.json>) [--account signer]",
        "queue_sent swap --swap <id> [--tx-hash <hash>] [--status succeeded|failed] [--amount-out <unit>]",
        "omit --status to record the transaction as sent",
        "--from-server reads the hashes off the engine: the human never has to paste one",
        "queue_sent swap without --tx-hash also reads the hash off the engine",
      ],
    });
    return;
  }

  const profile = await shit_1170_account_resolve_fun(
    args_string_fun(args, "account"),
  );
  const baseUrl = shit_1170_base_url_fun(
    args_string_fun(args, "base-url") ?? profile.baseUrl,
  );

  if (command === "tx") {
    const queueId = args_require_string_fun(args, "queue");
    const hashesFile = args_string_fun(args, "hashes");
    const fromServer = args_bool_fun(args, "from-server");

    if (hashesFile && fromServer) {
      throw new Error(
        "use either --hashes <file> or --from-server, not both: the file gives the hashes by hand and --from-server reads them off the engine",
      );
    }

    let hashes: SHIT_1170_TX_QUEUE_HASH_REQUEST[];
    let from: "file" | "server";

    if (fromServer) {
      // --- WHY THE HASHES COME FROM THE ENGINE: the engine records the
      // hash on the account row when the human's wallet reports the
      // send. so the hash is already there, and the human never has to
      // paste one into a file.
      const serverHashes = await shit_1170_tx_hashes_fun(queueId, {
        baseUrl,
      });
      if (serverHashes.length === 0) {
        throw new Error(
          `the engine has no hash for ${queueId} yet: the batch has not been sent, or the send was not reported to the engine. wait for it, or use --hashes <file>`,
        );
      }
      hashes = serverHashes.map((one) => ({
        txId: one.txId,
        txHash: one.txHash,
      }));
      from = "server";
    } else {
      const file = args_require_string_fun(args, "hashes");
      hashes = validate_hashes_fun(JSON.parse(await readFile(file, "utf8")));
      from = "file";
    }

    const result = await quiet_fun(() =>
      api_shit_1170_tx_queue_sent_post(
        baseUrl,
        queueId,
        { txHashes: hashes },
        { api_key: profile.apiKey },
      ),
    );
    const existing = await shit_1170_queue_record_get_fun("tx", queueId);
    await shit_1170_queue_record_put_fun({
      kind: "tx",
      id: queueId,
      request: existing?.request ?? { txHashes: hashes },
      response: result as unknown as Record<string, unknown>,
    });
    print_json_fun({
      ok: true,
      hashesFrom: from,
      queue: result,
    });
    return;
  }

  if (command === "swap") {
    const swapId = args_require_string_fun(args, "swap");
    const statusRaw = args_string_fun(args, "status");
    const status = statusRaw === undefined ? undefined : parse_status_fun(statusRaw);
    const amountOut = args_string_fun(args, "amount-out");

    let txHash = args_string_fun(args, "tx-hash");
    let from: "flag" | "server" = "flag";

    if (!txHash) {
      // --- WHY THE HASH COMES FROM THE ENGINE: the engine records the
      // hash on the account row when the swap was reported as sent. so
      // the hash is already there, and the human never has to paste one.
      txHash = (await shit_1170_swap_hash_fun(swapId, { baseUrl })) ?? undefined;
      from = "server";
      if (!txHash) {
        throw new Error(
          `the engine has no hash for ${swapId} yet: the swap has not been sent, or the send was not reported to the engine. pass --tx-hash <hash> if you have it`,
        );
      }
    }

    const result = await quiet_fun(() =>
      api_shit_1170_swap_queue_sent_post(
        baseUrl,
        swapId,
        {
          txHash,
          status,
          amountOut,
        },
        { api_key: profile.apiKey },
      ),
    );
    const existing = await shit_1170_queue_record_get_fun("swap", swapId);
    await shit_1170_queue_record_put_fun({
      kind: "swap",
      id: swapId,
      request: existing?.request ?? { txHash, status, amountOut },
      response: result as unknown as Record<string, unknown>,
    });
    print_json_fun({
      ok: true,
      hashFrom: from,
      swap: result,
    });
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
