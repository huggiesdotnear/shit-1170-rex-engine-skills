---
name: shit-1170-rex-keys
description: "Generate limited NEAR access keys and queue their addition and removal with the shit-1170 rex engine. Use this skill whenever the user mentions a limited access key, a limited key, a function call key, an access key, adding a key to an account, removing a key from an account, listing the keys of an account, a key that may call one contract, a key limited to certain methods, an allowance on a key, or a seed phrase for a NEAR key — including when the user asks for a key for a bot, a script, a teammate or an integration, or asks which keys an account already has. Every key offered to an account is a fresh one, and the private key and the seed phrase are kept in the local store. The agent never signs: the addition or the removal is queued for a human to approve."
---

# shit-1170 rex keys

make a limited access key, offer it to an account, take it away again, and
read the keys an account already has.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture:
<https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>.
this skill holds the keys.

**the rule that applies here too:** the agent never signs. a key that
is added to an account is queued, and a human approves it in the web
app with their wallet, exactly like every other queued transaction.

---

#### WHAT A LIMITED ACCESS KEY IS

a NEAR account has access keys. one of them is the account itself — the
**full access key**, which can move the money and do anything the
account can do. the others are **limited keys**: each one names a
single contract, the methods it may call on that contract, and how much
of the attached deposit it may spend.

a limited key is safe to hand to somebody else. a bot, a script, a
teammate, a service. it cannot move the account's funds and it cannot
touch anything but the one contract it was made for.

**a full access key is the account.** removing one locks the holder out
of their own money, so the engine refuses to queue that — and so does
this skill, before the request goes out.

---

#### THE BINS

all bins live in `bin/`, are run with `bun`, print JSON on stdout, and
print JSON errors on stderr with a non-zero exit code.

| bin | kind | what it does |
| --- | --- | --- |
| `key_generate.ts` | local | make a key pair and keep it |
| `key_queue_add.ts` | engine | make a key and queue its addition to an account |
| `key_queue_remove.ts` | engine | queue the removal of a key from an account |
| `key_list.ts` | local | list the keys this agent generated and offered |
| `key_chain.ts` | chain VIEW | read the access keys an account has |

the `kind` column says where the answer comes from:

- **chain VIEW** — a read straight from NEAR. no API key, no server, no
  account.
- **engine** — a write to the engine's server. needs an API key.
- **local** — no network at all. it reads or writes the local files.

### --- KEY_GENERATE.TS ---

```sh
bun bin/key_generate.ts
```

makes a key pair and keeps it. the private key goes into the local
store and is not printed:

```json
{
  "ok": true,
  "public_key": "ed25519:C2mjDgJcyzymRfHNpEEe7yLkXGw12FR2rU3wfzdc1T9M",
  "seed_phrase": null,
  "derivation_path": null,
  "recoverable": false,
  "store_path": "/home/you/.shit-1170-rex-engine/keys/keys.sqlite"
}
```

| flag | what it does |
| --- | --- |
| `--seed` | derive the key from a new seed phrase instead of at random |
| `--word-count <n>` | the phrase's length. 12, 15, 18, 21 or 24. default 12 |
| `--path <path>` | the derivation path. default `m/44'/397'/0'`, NEAR's |
| `--show-seed` | print the seed phrase. needs `--seed` |

**`--seed` is opt-in, and it is the only way to get a phrase.** a
random key is recovered by keeping the private key. a phrase-derived
key is recovered by the phrase, which is the thing people know how to
write down.

the seed phrase is **not** printed unless `--show-seed` is asked for. a
phrase in a transcript is a phrase in a log, so ask for it on purpose
and say why.

**the phrase is real and it works.** the key is derived from it with
SLIP-0010 at NEAR's path, so the same phrase recovers the same key in
the NEAR CLI and in NEAR wallets. near-kit does the derivation and
already ships it — nothing else is needed for it.

### --- KEY_QUEUE_ADD.TS ---

```sh
bun bin/key_queue_add.ts --receiver-id ref.finance.near --methods ft_swap --allowance 1000000000000000000000000
```

makes a **new** key, keeps it, and queues an `add_key` for the account.
the human approves it in the web app and the key lands on the account
then.

| flag | what it does |
| --- | --- |
| `--receiver-id <contract>` | the contract the key may call. required |
| `--method <name>` | one method the key may call |
| `--methods <a,b,c>` | several methods the key may call |
| `--allowance <yoctoNEAR>` | how much of the deposit the key may spend |
| `--account <account_id>` | the account the key is for. default: the stored one |
| `--public-key <key>` | re-queue an addition that was refused, with that key |
| `--seed` | make the key from a seed phrase |
| `--show-seed` | print the seed phrase |

**the allowance is in yoctoNEAR.** `0.5` is not what goes here. use the
unit conversion skill to turn a human amount into the chain's unit
amount.

**no method names means every method** on that contract. that is
valid, and it is a bigger key than it looks. when the contract's method
list is known, pass it.

**a key offered to an account is never offered again.** every call
makes a fresh key. a key that was already handed to somebody else has
another holder, and that holder can sign anything the new one can.

the `--public-key` flag exists for one reason: to re-queue an addition
that was **refused** with the same key. it is refused when that key was
already offered to an account, and when this agent does not hold it.

### --- KEY_QUEUE_REMOVE.TS ---

```sh
bun bin/key_queue_remove.ts --public-key ed25519:9kN7TmWGzRxko5T8yCQ5Czt7zwKzWxLSuU7WRv13NvYK
```

queues a `delete_key` for the account. the human approves it and the
key comes off the account then.

| flag | what it does |
| --- | --- |
| `--public-key <key>` | the key to remove |
| `--account <account_id>` | the account to remove it from. default: the stored one |
| `--skip-chain-check` | do not read the account's keys first |

**without `--public-key`, the key this agent offered that account most
recently is used.** an agent removing a key it put there should not
have to remember a public key.

**the chain is read before the batch is written**, so the refusal
comes back in plain words instead of a 400:

- a key that is not on the account → nothing to remove
- a key that was queued but not yet approved → it is not there yet
- a **full access key** → refused. it IS the account, and removing it
  locks the holder out.

the engine checks the chain again when the batch arrives, so the
refusal is the backend's as well as this bin's.

### --- KEY_LIST.TS ---

```sh
bun bin/key_list.ts
```

lists two things. the **generated** keys are every key pair this agent
ever made. the **offered** keys are the ones that were queued for an
account, with the contract, the methods and the allowance they were
offered with.

| flag | what it does |
| --- | --- |
| `--generated` | only the generated keys |
| `--offered` | only the offered keys |
| `--account <account_id>` | narrow the offered list to one account |

**the private key and the seed phrase are never in the listing.** a
listing is a thing an agent reads and then repeats in a conversation,
and a secret that is read is a secret that is copied.

### --- KEY_CHAIN.TS ---

```sh
bun bin/key_chain.ts --account-id sleet.near
```

reads the access keys an account has, off the chain:

```json
{
  "ok": true,
  "account_id": "sleet.near",
  "network": "mainnet",
  "block_height": 224235975,
  "keys": [
    {
      "public_key": "ed25519:9kN7TmWGzRxko5T8yCQ5Czt7zwKzWxLSuU7WRv13NvYK",
      "full_access": false,
      "receiver_id": "dclv2.ref-labs.near",
      "method_names": [],
      "allowance": null,
      "nonce": 0,
      "held_locally": false
    }
  ],
  "limited_count": 21,
  "full_access_count": 19
}
```

| flag | what it does |
| --- | --- |
| `--account-id <account_id>` | the account. required |
| `--network mainnet\|testnet` | the network. default `mainnet` |
| `--limited-only` | hide the full access keys |

**`held_locally` marks the keys this agent can sign with.** the chain
says which keys an account has; it does not say which of them THIS
agent holds the private key for. the agent's own store answers that.

run this before queueing a removal. it is the way to tell which keys
are the agent's own and which were made by somebody else.

---

#### THE TWO STORES

**every key this agent generates is kept in a sqlite file**, and **every
key it offers to an account is kept in a json file**. a key that was
offered is in both, so it is saved twice.

```text
${HOME}/.shit-1170-rex-engine/
└── keys/
    ├── keys.sqlite              # every key pair ever generated
    └── added/
        └── ed25519_7qAZp4m....json  # one file per offered key
```

set `SHIT_1170_REX_HOME` to use a different directory — the same
override every skill uses.

**the sqlite file holds the SECRET.** the private key of every key ever
generated, and the seed phrase when there was one. the file is 0600.

**the json file holds the DEAL.** which account the key was offered to,
which contract it may call, which methods, which allowance, and which
queue it went out in. the file is 0600 and it does NOT hold the
private key.

the split is deliberate. a json file is the easy one to copy, to sync,
to paste into a bug report. the secret stays in one 0600 sqlite file,
and the details — which are not a secret — sit where a reader can see
them.

**a key that was generated and never offered is in the sqlite and in no
json file.** the json files exist for the keys that were handed out.

the json file is named after the public key, so a removal **overwrites**
the record of the addition: the file then says what happened last to
that key.

---

#### THE FLOW

1. **look at the account** — `key_chain.ts` for the keys it has now.
2. **make the key** — `key_queue_add.ts` does both, and it makes a new
   one every time.
3. **explain it** — the contract, the methods, the allowance, in plain
   language, before it is queued.
4. **queue it** — the human approves it in the web app.
5. **keep the copy** — the local store has the key and the details.
6. **follow it** — when the human says it is signed, read the queue back
   with the engine skill's `get_queue.ts`.

**say what the key can do before it is queued.** a limited key that may
call every method on a contract is a different thing from one that may
call two, and the human is the one approving it.

---

#### WHEN A KEY IS REMOVED

a key comes off an account when it is no longer needed, or when it
leaked. the removal is queued the same way the addition was, and the
human approves it.

**a full access key cannot be removed this way.** it IS the account.
the engine refuses it, and so does this skill.

**a key that was queued but never approved was never on the account**,
so there is nothing to remove. the bin says so plainly.

---

#### MORE

- the engine skill's
  [SKILL.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md)
  — the queueing mechanics
- the library's
  [TOOLS.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/DOCS/TOOLS.md)
  — where the facts come from
- the engine's own
  [ENGINE.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/DOCS/ENGINE.md)
  — the routes and the data model

=====================
<br/>
copyright 2026 by sleet.near
