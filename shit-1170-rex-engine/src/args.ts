export interface SHIT_1170_ARGS {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function shit_1170_parse_args_fun(argv: string[]): SHIT_1170_ARGS {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const raw_name = token.slice(2);
    const equals = raw_name.indexOf("=");
    if (equals >= 0) {
      flags[raw_name.slice(0, equals)] = raw_name.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[raw_name] = true;
      continue;
    }
    flags[raw_name] = next;
    index += 1;
  }

  return { positional, flags };
}

export function shit_1170_flag_string_fun(
  args: SHIT_1170_ARGS,
  name: string,
  fallback?: string,
): string | undefined {
  const value = args.flags[name];
  if (typeof value === "string") return value;
  return fallback;
}

export function shit_1170_flag_bool_fun(
  args: SHIT_1170_ARGS,
  name: string,
): boolean {
  const value = args.flags[name];
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function shit_1170_require_string_fun(
  args: SHIT_1170_ARGS,
  name: string,
): string {
  const value = shit_1170_flag_string_fun(args, name);
  if (!value || value.trim().length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value.trim();
}

export function shit_1170_flag_number_fun(
  args: SHIT_1170_ARGS,
  name: string,
  fallback?: number,
): number | undefined {
  const value = shit_1170_flag_string_fun(args, name);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${name} must be a number`);
  return number;
}
