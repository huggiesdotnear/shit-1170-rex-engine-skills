# shit-1170-rex-ft

fungible token transfers for the shit-1170 rex engine.

prepare an NEP-141 transfer, check the receiver, and queue it for a
human to sign. also covers wrapping and unwrapping NEAR through
`wrap.near`.

see [SKILL.md](./SKILL.md)

---

#### THE BINS

```sh
bun bin/ft_check.ts --token <token_id> --receiver <account_id>
bun bin/ft_transfer.ts --token <token_id> --receiver <account_id> --amount <unit_amount> [--force]
bun bin/ft_balance.ts --token <token_id> --account <account_id>
bun bin/ft_metadata.ts --token <token_id>
bun bin/token_info.ts --token <token_id[,token_id,...]>
bun bin/holders.ts --token <token_id> [--limit 100] [--cursor <cursor>]
bun bin/balances.ts --account <account_id> [--sources direct,native,rhea] [--tokens token_a,token_b]
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

#### THE TOKEN INFO

the chain is authoritative for a token's **metadata** — its name, its
symbol and its decimals. the token says that about itself.

the **intear API** adds what the chain does not know: the price, the
liquidity, the market cap and the pool the token trades in.

`token_info.ts` reads both and labels which is which:

```sh
bun bin/token_info.ts --token wrap.near
```

when the two disagree about the symbol or the decimals, the chain
wins — the API's symbol is a label, and the same symbol can name
different tokens with different decimals. a token the API lists under
`missing` is one the indexer has not seen, not a broken token.

---

#### THE HOLDERS

`holders.ts` reads a token's **indexed** holder list, paged with the
cursor the server gives.

```sh
bun bin/holders.ts --token shit-1170.meme-cooking.near --limit 100
```

the list is not classified here — the website's dev / dex / vault /
nft / burn / regular split is the website's own. for the holder count
alone, `token_info.ts --fields holders` gives it in one call.

---

#### THE BALANCES

`balances.ts` reads an account's balances the way the website shows
them, across three sources: `direct` (its own token balances),
`native` (its NEAR) and `rhea` (its deposits in the Rhea AMM).

```sh
bun bin/balances.ts --account alice.near --sources direct,native
```

the `rhea` source is the AMM v2's internal balance only — the Rhea DCL
v2 internal balance and INTEAR's need the contract's own skill.

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

`wrap.ts` prints the queue payload and sends nothing.

**the storage registration in a wrap is CONDITIONAL.** the bin reads
the account's registration and includes the `storage_deposit` only when
the account is missing it — so an account that has wrapped before gets
a one-call batch, and a first-time account gets a two-call batch. a
redundant registration would waste 0.00125 NEAR and a call.

`--with-storage-deposit auto|yes|no` overrides the read.

the full reference is in [DOCS/WRAP.NEAR.md](./DOCS/WRAP.NEAR.md).

=====================
<br/>
copyright 2026 by sleet.near
