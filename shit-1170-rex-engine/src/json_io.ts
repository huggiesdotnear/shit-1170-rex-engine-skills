import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * read a json file, or null when it is not there.
 *
 * a file that is not there is an answer here — the local store is
 * empty until something is written to it. a file that is there and
 * broken IS an error: silently treating a corrupt store as empty would
 * lose the record of what the agent queued.
 */
export async function shit_1170_read_json_fun<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * write a json file, making the folders it needs on the way.
 *
 * `private_file` writes it 0600 — for the files that hold a key.
 */
export async function shit_1170_write_json_fun(
  path: string,
  value: unknown,
  private_file = false,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: private_file ? 0o600 : 0o644,
  });
  if (private_file) await chmod(path, 0o600);
}
