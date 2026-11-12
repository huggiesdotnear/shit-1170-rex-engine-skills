# shit-1170-rex-keys

limited NEAR access keys for the shit-1170 rex engine: make one, offer
it to an account, take it away again, and read the keys an account
already has.

**the agent never signs.** a key that is added to an account is queued
and a human approves it in the web app with their wallet, exactly like
every other queued transaction.

- the skill: [SKILL.md](./SKILL.md)
- the engine skill, for the queueing mechanics:
  [shit-1170-rex-engine](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md)

## the bins

```sh
# make a key pair and keep it
bun bin/key_generate.ts

# make a key from a seed phrase, and print the phrase
bun bin/key_generate.ts --seed --show-seed

# queue a limited key for an account
bun bin/key_queue_add.ts --receiver-id ref.finance.near --methods ft_swap --allowance 1000000000000000000000000

# queue the removal of a key
bun bin/key_queue_remove.ts --public-key ed25519:9kN7TmWGzRxko5T8yCQ5Czt7zwKzWxLSuU7WRv13NvYK

# what this agent generated, and what it offered
bun bin/key_list.ts

# what the account has, read off the chain
bun bin/key_chain.ts --account-id sleet.near
```

## the two stores

every key this agent generates is kept in a sqlite file, and every key
it offers to an account is kept in a json file. a key that was offered
is in both, so it is saved twice.

```text
${HOME}/.shit-1170-rex-engine/
└── keys/
    ├── keys.sqlite                # every key pair ever generated
    └── added/
        └── ed25519_7qAZp4m....json  # one file per offered key
```

set `SHIT_1170_REX_HOME` to use a different directory.

**the sqlite file holds the secret** — the private key of every key ever
generated, and the seed phrase when there was one. it is 0600.

**the json file holds the deal** — which account the key was offered to,
which contract it may call, which methods, which allowance, and which
queue it went out in. it is 0600, and it does not hold the private key.

## a new key every time

a key offered to an account is **never** offered again. every call to
`key_queue_add.ts` makes a fresh one.

a key that was already handed to somebody else has another holder, and
that holder can sign anything the new one can. so the old key is not
picked up again — it is only reused to re-queue an addition that was
refused, with `--public-key`.

## the seed phrase

`--seed` derives the key from a new BIP-39 phrase instead of at random,
with SLIP-0010 at NEAR's path `m/44'/397'/0'`. the same phrase recovers
the same key in the NEAR CLI and in NEAR wallets.

near-kit already ships the generation and the derivation, so nothing
else is needed for it.

**the phrase is not printed unless `--show-seed` is asked for.** a
phrase in a transcript is a phrase in a log.

## the full access key

a full access key IS the account. it can move the money and do anything
the account can do, so removing one locks the holder out.

the engine refuses to queue the removal, and so does this skill — with
the reason in plain words, before the request goes out.

## the sources

- near-kit's `generateSeedPhrase` / `parseSeedPhrase` — the phrase and
  the SLIP-0010 derivation, NEAR's path `m/44'/397'/0'`
- the chain's `view_access_key_list` — what an account's keys are
- the engine's tx-queue route — the `add_key` and `delete_key` actions

=====================
<br/>
copyright 2026 by sleet.near
