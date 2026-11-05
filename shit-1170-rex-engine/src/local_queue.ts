import { join } from "node:path";
import {
  shit_1170_queues_path_fun,
  shit_1170_swap_queue_dir_fun,
  shit_1170_tx_queue_dir_fun,
} from "./paths";
import {
  shit_1170_read_json_fun,
  shit_1170_write_json_fun,
} from "./json_io";
import type {
  SHIT_1170_LOCAL_QUEUE_RECORD,
  SHIT_1170_LOCAL_QUEUES_FILE,
} from "./types";

function safe_id_fun(id: string): string {
  const safe = id.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe) throw new Error("id is required");
  return safe;
}

export function shit_1170_queue_record_path_fun(
  kind: "tx" | "swap",
  id: string,
): string {
  const directory =
    kind === "tx" ? shit_1170_tx_queue_dir_fun() : shit_1170_swap_queue_dir_fun();
  return join(directory, `${safe_id_fun(id)}.json`);
}

export async function shit_1170_queue_record_save_fun(
  record: SHIT_1170_LOCAL_QUEUE_RECORD,
): Promise<string> {
  const path = shit_1170_queue_record_path_fun(record.kind, record.id);
  await shit_1170_write_json_fun(path, record);
  return path;
}

export async function shit_1170_queue_record_get_fun(
  kind: "tx" | "swap",
  id: string,
): Promise<SHIT_1170_LOCAL_QUEUE_RECORD | null> {
  return shit_1170_read_json_fun<SHIT_1170_LOCAL_QUEUE_RECORD>(
    shit_1170_queue_record_path_fun(kind, id),
  );
}

export async function shit_1170_queue_records_list_fun(): Promise<
  SHIT_1170_LOCAL_QUEUE_RECORD[]
> {
  const file = await shit_1170_read_json_fun<SHIT_1170_LOCAL_QUEUES_FILE>(
    shit_1170_queues_path_fun(),
  );
  return file?.records ?? [];
}

export async function shit_1170_queue_index_update_fun(
  record: SHIT_1170_LOCAL_QUEUE_RECORD,
): Promise<void> {
  const records = await shit_1170_queue_records_list_fun();
  const next = records.filter(
    (item) => !(item.kind === record.kind && item.id === record.id),
  );
  next.push(record);
  await shit_1170_write_json_fun(shit_1170_queues_path_fun(), {
    records: next,
  } satisfies SHIT_1170_LOCAL_QUEUES_FILE);
}

export async function shit_1170_queue_record_put_fun(
  input: {
    kind: "tx" | "swap";
    id: string;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  },
): Promise<SHIT_1170_LOCAL_QUEUE_RECORD> {
  const existing = await shit_1170_queue_record_get_fun(input.kind, input.id);
  const now = Date.now();
  const localPath = shit_1170_queue_record_path_fun(input.kind, input.id);
  const record: SHIT_1170_LOCAL_QUEUE_RECORD = {
    kind: input.kind,
    id: input.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    request: input.request,
    response: input.response,
    localPath,
  };
  await shit_1170_queue_record_save_fun(record);
  await shit_1170_queue_index_update_fun(record);
  return record;
}
