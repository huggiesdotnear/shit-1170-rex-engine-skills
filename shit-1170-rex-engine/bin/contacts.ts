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
  shit_1170_contact_add_fun,
  shit_1170_contact_has_fun,
  shit_1170_contact_remove_fun,
  shit_1170_contacts_read_fun,
} from "../src/contacts";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  const command = args.positional[0] ?? "help";

  if (command === "list") {
    const contacts = await shit_1170_contacts_read_fun();
    print_json_fun({ ok: true, contacts });
    return;
  }

  if (command === "add") {
    const contact = await shit_1170_contact_add_fun(
      args_require_string_fun(args, "account"),
      {
        label: args_string_fun(args, "label"),
        note: args_string_fun(args, "note"),
      },
    );
    print_json_fun({ ok: true, contact });
    return;
  }

  if (command === "remove") {
    const removed = await shit_1170_contact_remove_fun(
      args_require_string_fun(args, "account"),
    );
    print_json_fun({ ok: true, removed });
    return;
  }

  if (command === "has") {
    const has = await shit_1170_contact_has_fun(
      args_require_string_fun(args, "account"),
    );
    print_json_fun({ ok: true, has });
    return;
  }

  if (command === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "contacts list",
        "contacts add --account <id> [--label text] [--note text]",
        "contacts remove --account <id>",
        "contacts has --account <id>",
      ],
    });
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
