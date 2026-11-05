#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../../shit-1170-rex-engine/src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../../shit-1170-rex-engine/src/json_io";
import {
  shit_1170_contact_add_fun,
  shit_1170_contact_has_fun,
  shit_1170_contact_remove_fun,
  shit_1170_contacts_read_fun,
} from "../../shit-1170-rex-engine/src/contacts";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  const command = args.positional[0] ?? "help";

  if (command === "list") {
    const contacts = await shit_1170_contacts_read_fun();
    shit_1170_print_json_fun({ ok: true, contacts });
    return;
  }

  if (command === "add") {
    const contact = await shit_1170_contact_add_fun(
      shit_1170_require_string_fun(args, "account"),
      {
        label: shit_1170_flag_string_fun(args, "label"),
        note: shit_1170_flag_string_fun(args, "note"),
      },
    );
    shit_1170_print_json_fun({ ok: true, contact });
    return;
  }

  if (command === "remove") {
    const removed = await shit_1170_contact_remove_fun(
      shit_1170_require_string_fun(args, "account"),
    );
    shit_1170_print_json_fun({ ok: true, removed });
    return;
  }

  if (command === "has") {
    const has = await shit_1170_contact_has_fun(
      shit_1170_require_string_fun(args, "account"),
    );
    shit_1170_print_json_fun({ ok: true, has });
    return;
  }

  if (command === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
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
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
