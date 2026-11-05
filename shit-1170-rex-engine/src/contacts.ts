import {
  shit_1170_contacts_path_fun,
} from "./paths";
import {
  shit_1170_read_json_fun,
  shit_1170_write_json_fun,
} from "./json_io";
import type { SHIT_1170_CONTACT, SHIT_1170_CONTACTS_FILE } from "./types";

export async function shit_1170_contacts_read_fun(): Promise<SHIT_1170_CONTACT[]> {
  const file = await shit_1170_read_json_fun<SHIT_1170_CONTACTS_FILE>(
    shit_1170_contacts_path_fun(),
  );
  return file?.contacts ?? [];
}

export async function shit_1170_contacts_write_fun(
  contacts: SHIT_1170_CONTACT[],
): Promise<void> {
  await shit_1170_write_json_fun(shit_1170_contacts_path_fun(), {
    contacts,
  } satisfies SHIT_1170_CONTACTS_FILE);
}

export async function shit_1170_contact_add_fun(
  account_id: string,
  options: { label?: string; note?: string } = {},
): Promise<SHIT_1170_CONTACT> {
  const id = account_id.trim();
  if (!id) throw new Error("account id is required");
  const contacts = await shit_1170_contacts_read_fun();
  const existing = contacts.find((item) => item.accountId === id);
  const contact: SHIT_1170_CONTACT = {
    accountId: id,
    label: options.label ?? existing?.label,
    note: options.note ?? existing?.note,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  const next = contacts.filter((item) => item.accountId !== id);
  next.push(contact);
  await shit_1170_contacts_write_fun(next);
  return contact;
}

export async function shit_1170_contact_remove_fun(
  account_id: string,
): Promise<boolean> {
  const id = account_id.trim();
  const contacts = await shit_1170_contacts_read_fun();
  const next = contacts.filter((item) => item.accountId !== id);
  if (next.length === contacts.length) return false;
  await shit_1170_contacts_write_fun(next);
  return true;
}

export async function shit_1170_contact_has_fun(
  account_id: string,
): Promise<boolean> {
  const id = account_id.trim();
  const contacts = await shit_1170_contacts_read_fun();
  return contacts.some((item) => item.accountId === id);
}
