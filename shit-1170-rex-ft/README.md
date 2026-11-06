# shit-1170-rex-ft

fungible token transfers for the shit-1170 rex engine.

prepare an NEP-141 transfer, check the receiver, and queue it for a
human to sign. also covers wrapping and unwrapping NEAR through
`wrap.near`.

see [SKILL.md](./SKILL.md)

---

#### THE ARCHITECTURE

**the agent never calls a contract.** it reads chain state with VIEW
methods and emits QUEUE PAYLOADS —
`{ contractId, method, args, gas, deposit }` — which the engine queues
for a human to sign in the web app.

the chain reads go through the near-kit tool box
(`@near-kit-tool-box/fun`), with the client built from `near-kit` so
the default network is mainnet.

---

#### THE BINS

```sh
bun bin/ft_check.ts --token <token_id> --receiver <account_id>
bun bin/ft_transfer.ts --token <token_id> --receiver <account_id> --amount <unit_amount> [--force]
bun bin/ft_balance.ts --token <token_id> --account <account_id>
bun bin/ft_metadata.ts --token <token_id>
bun bin/wrap_check.ts --account <account_id>
bun bin/wrap.ts --direction wrap|unwrap|storage --amount <unit_amount>
bun bin/contacts.ts list
bun bin/contacts.ts add --account <account_id> [--label text]
bun bin/contacts.ts remove --account <account_id>
bun bin/contacts.ts has --account <account_id>
```

every bin prints JSON on stdout and JSON errors on stderr with a
non-zero exit code. a refusal exits 2.

---

#### THE CONTACT LIST

the contact list lives at `${HOME}/.shit-1170-rex-engine/contacts.json`.

a transfer to an account that is not on the list is refused unless the
human approved it and `--force` was passed. confirm the address with
the human before adding it.

---

#### THE CHECKS

`ft_check.ts` answers, in one call:

- does the receiver account exist on chain?
- is it on the contact list?
- does it have NEP-145 storage on the token? a `null` from
  `storage_balance_of` means it cannot hold the token, and a transfer
  to it can succeed and deliver nothing
- what are the token's decimals?

`ft_metadata.ts` reports the token's real storage minimum, so a
`storage_deposit` attaches what the token actually wants.

---

#### WRAPPING AND UNWRAPPING

`wrap.near` turns native NEAR into wNEAR and back. a wrap is a batch
of calls, not a swap — `near_deposit` and `near_withdraw` are direct
calls to the contract.

`wrap_check.ts` answers:

- does the account exist?
- how much native NEAR does it hold?
- how much wNEAR does it hold?
- is it registered for NEP-145 storage on `wrap.near`? without that,
  `near_deposit` cannot mint to it
- what is the contract's live storage minimum?

`wrap.ts` prints the queue payload and sends nothing. a wrap carries
its storage registration in the same batch, in front of the deposit.

=====================
<br/>
copyright 2026 by sleet.near
