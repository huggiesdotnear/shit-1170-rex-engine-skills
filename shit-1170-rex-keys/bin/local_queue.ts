import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// the LOCAL COPY of a queued batch.
//
// --- WHY THIS SKILL KEEPS ITS OWN COPY ---
// the engine skill keeps the local copy of every queued batch under
// `${HOME}/.shit-1170-rex-engine/queue/`. this skill writes there too,
// with the same shape, so the engine skill's `get_queue.ts` and
// `sync_queue.ts` read a batch queued by this skill the same way they
// read one queued by the engine skill.
//
// the copy holds the request as the agent wrote it and the response as
// the server returned it. so it is a record of what was proposed, what
// was queued, and what happened next.
//
// --- WHY THE FILE IS 0600 ---
// a queued batch can name a key. the batch itself says which public key
// and which account — not the secret — but the account and the key are
// the account's business, so the file is kept to the owner.

export interface SHIT_1170_KEY_LOCAL_RECORD {
  kind: "tx" | "swap";
  id: string;
  createdAt: number;
  updatedAt: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  localPath: string;
}

/**
 * the folder the engine skill keeps the local copies in.
 */
function queue_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  const home = from_env
    ? from_env
    : join(homedir(), ".shit-1170-rex-engine");
  return join(home, "queue");
}

function record_path_fun(kind: "tx" | "swap", id: string): string {
  const safe = id.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe) throw new Error("id is required");
  return join(queue_dir_fun(), kind, `${safe}.json`);
}

function index_path_fun(): string {
  return join(queue_dir_fun(), "index.json");
}

/**
 * read the index of the local copies.
 *
 * the index is the engine skill's own file, so its shape is the engine
 * skill's shape: `{ records: [...] }`, with the WHOLE record on each
 * entry. a bare array would be read as an empty index by the engine
 * skill's `get_queue.ts` and `sync_queue.ts`, and the local copies
 * would look like they were never written.
 */
async function index_read_fun(): Promise<
  Array<Record<string, unknown>>
> {
  try {
    const text = await readFile(index_path_fun(), "utf8");
    const parsed = JSON.parse(text) as {
      records?: Array<Record<string, unknown>>;
    };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * add one record to the index, replacing any record with the same id.
 */
async function index_update_fun(record: SHIT_1170_KEY_LOCAL_RECORD): Promise<void> {
  const entries = await index_read_fun();
  const out = entries.filter(
    (one) =>
      !(
        one.kind === record.kind &&
        one.id === record.id
      ),
  );
  out.push(record as unknown as Record<string, unknown>);
  const path = index_path_fun();
  await mkdir(queue_dir_fun(), { recursive: true });
  await writeFile(path, `${JSON.stringify({ records: out }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

/**
 * the existing record for one id, or null.
 */
async function record_get_fun(
  kind: "tx" | "swap",
  id: string,
): Promise<SHIT_1170_KEY_LOCAL_RECORD | null> {
  try {
    const text = await readFile(record_path_fun(kind, id), "utf8");
    return JSON.parse(text) as SHIT_1170_KEY_LOCAL_RECORD;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * write the local copy of a queued batch.
 *
 * the created time is kept from the first write, so the record's age is
 * the age of the proposal and not the age of the last refresh.
 */
export async function shit_1170_local_queue_record_put_fun(input: {
  kind: "tx" | "swap";
  id: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}): Promise<SHIT_1170_KEY_LOCAL_RECORD> {
  const existing = await record_get_fun(input.kind, input.id);
  const now = Date.now();
  const localPath = record_path_fun(input.kind, input.id);

  const record: SHIT_1170_KEY_LOCAL_RECORD = {
    kind: input.kind,
    id: input.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    request: input.request,
    response: input.response,
    localPath,
  };

  await mkdir(join(queue_dir_fun(), input.kind), { recursive: true });
  await writeFile(localPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(localPath, 0o600);

  await index_update_fun(record);

  return record;
}

/**
 * the local copies this skill wrote, newest first.
 */
export async function shit_1170_local_queue_record_list_fun(): Promise<
  Array<SHIT_1170_KEY_LOCAL_RECORD>
> {
  const directory = join(queue_dir_fun(), "tx");
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Array<SHIT_1170_KEY_LOCAL_RECORD> = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    try {
      const text = await readFile(`${directory}/${name}`, "utf8");
      const record = JSON.parse(text) as SHIT_1170_KEY_LOCAL_RECORD;
      out.push(record);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
