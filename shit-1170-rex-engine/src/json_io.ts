import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

/**
 * Run a call with the middleman's request/response logging moved to
 * stderr.
 *
 * the middleman prints a banner with console.log, which lands on
 * stdout. the bins promise pure JSON on stdout, so a shell pipeline
 * doing JSON.parse(stdout) would break without this.
 */
export async function shit_1170_quiet_fun<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(`${args.map((arg) => String(arg)).join(" ")}\n`);
  };
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

export function shit_1170_print_json_fun(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function shit_1170_print_error_fun(message: string): void {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
}
