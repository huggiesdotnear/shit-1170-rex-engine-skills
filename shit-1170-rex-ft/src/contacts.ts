import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { shit_1170_contacts_path_fun } from "./paths";

// the contact list: the accounts the human has read and agreed to.
//
// --- WHY --- THE LIST IS A DELIBERATE ACT: a mistyped NEAR account id
// is a valid account id. it usually belongs to somebody else, and the
// transfer succeeds. so an account goes on the list because a human
// read it and said yes — not because it looked right.
//
// --- WHY --- THE LIST LIVES IN THIS SKILL: the contact check is the
// FT skill's safety check, and the transfer is what it guards. a skill
// that reached into a sibling folder for its own state could not be
// copied out on its own.

export interface SHIT_1170_CONTACT {
  accountId: string;
  label?: string;
  note?: string;
  createdAt?: number;
}

export interface SHIT_1170_CONTACTS_FILE {
  contacts: SHIT_1170_CONTACT[];
}

/**
 * read the contact list.
 *
 * a file that is not there is an empty list — the list starts empty.
 */
export async function shit_1170_contacts_read_fun(): Promise<SHIT_1170_CONTACT[]> {
  const file = await read_json_fun<SHIT_1170_CONTACTS_FILE>(
    shit_1170_contacts_path_fun(),
  );
  return file?.contacts ?? [];
}

/**
 * write the contact list.
 */
export async function shit_1170_contacts_write_fun(
  contacts: SHIT_1170_CONTACT[],
): Promise<void> {
  await write_json_fun(shit_1170_contacts_path_fun(), {
    contacts,
  } satisfies SHIT_1170_CONTACTS_FILE);
}

/**
 * add a contact, or update the one already there.
 *
 * adding the same account twice keeps the label and the note it had,
 * because the label is the human's own word for that account and a
 * second add is not a reason to forget it.
 */
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

/**
 * remove a contact. false when it was not there.
 */
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

/**
 * is this account on the list?
 */
export async function shit_1170_contact_has_fun(
  account_id: string,
): Promise<boolean> {
  const id = account_id.trim();
  const contacts = await shit_1170_contacts_read_fun();
  return contacts.some((item) => item.accountId === id);
}

// --- THE FILES ------------------------
/**
 * read a json file, or null when it is not there.
 *
 * a file that is not there is an answer — the list starts empty. a
 * file that is there and broken is an error: treating a corrupt list
 * as an empty one would drop every contact the human agreed to.
 */
async function read_json_fun<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function write_json_fun(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
