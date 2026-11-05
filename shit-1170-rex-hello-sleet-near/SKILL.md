---
name: shit-1170-rex-hello-sleet-near
description: Read the hello.sleet.near greeting contract on mainnet and testnet with the shit-1170 rex engine — the deployed contract ids, each method's call type, exact argument shape, and gas and deposit. Use this skill whenever the user mentions hello.sleet.near, hello.sleet.testnet, the sleet greeting contract, get_greeting, set_greeting, or wants to read the current greeting or set a new one — including when they want to know what arguments a greeting contract method takes, or need the greeting contract's id for the right network. Also use it when a queued transaction calls the greeting contract and the agent must check the method name, the arguments, the gas, or the deposit. Emit a queue payload for a human to sign; never send it yourself.
---

# shit-1170 rex hello.sleet.near

the hello.sleet.near greeting contract.

- live site: <https://shit-1170.com/>
- code: <https://github.com/huggiesdotnear/shit-1170-rex-engine>

use the general `shit-1170-rex-engine` skill for the queueing
mechanics. this skill holds the contract's methods and arguments.

---

#### THE ARCHITECTURE

**the agent NEVER calls a contract.**

every state-changing call goes through the rex engine as a QUEUED
generic function call, and a HUMAN signs it in the web app with their
wallet. so:

- this skill only needs VIEW methods to read chain state.
- for a write, this skill emits a QUEUE PAYLOAD —
  `{ contractId, method, args, gas, deposit }` — the exact shape the
  engine's tx-queue accepts. the engine queues it for a human to
  sign. it is NOT a near-kit transaction and NOT a `near.call`.
- never call `near.call`, `generic_contract_call_fun`, or
  `generic_contract_call_wallet` from a skill bin. the `*_fun_json`
  helpers that CALL (not view) are for reference only: use their
  argument shape, gas, and deposit, but emit a queue payload instead
  of sending.

**queue the transaction; do not send it.** the engine queues a batch
for a human to sign in one wallet popup. your job ends when the batch
is queued and explained. never claim a transaction was sent.

---

#### THE TOOLS

the chain reads go through the near-kit tool box:

- `@near-kit-tool-box/fun` — typed helpers with Zod-validated
  answers. `greeting_get_greeting_fun_json` reads the greeting, and
  `greeting_contractid(network)` resolves the contract id for a
  network. `generic_contract_view_fun_json` is the escape hatch for
  views that have no dedicated helper.
- `@near-kit-tool-box/env` — the server-side client setup.
- `near-kit` — the client itself. the skill builds
  `new Near({ network })` from it, so the default is MAINNET. the env
  package's own default is testnet, which is why the skills do not
  use its client directly.

`@near-kit-tool-box/web` is the BROWSER-wallet variant. it needs a
browser wallet and `localStorage`. the frontend uses it. this skill
does not — a skill bin runs in a terminal, has no wallet, and must
never sign anything.

---

#### CONTRACT IDS

- MAINNET: `hello.sleet.near`
- TESTNET: `hello.sleet.testnet`

the network decides the id. the testnet contract is a different
contract, not a copy of the mainnet one — a call to the wrong one
fails with `MethodResolveError`.

---

#### THE METHODS

### get_greeting - VIEW

no arguments. gas: none — a view call is read-only. attached
deposit: 0.

answers with the current greeting, as a plain string.

### set_greeting - CALL

```json
{
  "greeting": "Hello"
}
```

- gas: 3 Tgas
- attached deposit: 0

the caller becomes the greeting's owner on a contract that stores one
greeting, so set it from the account whose name should appear.

**the greeting is the whole argument.** there is no `account_id`, no
`receiver_id`, and no `msg`. an extra field is ignored by the
contract, so a wrong argument shape often looks like it worked.

---

#### WRITES ARE QUEUED, NEVER SENT

`set_greeting` produces a QUEUE PAYLOAD — data, not an action. the
engine queues it and a human signs it.

```json
{
  "contractId": "hello.sleet.near",
  "method": "set_greeting",
  "args": { "greeting": "Hello" },
  "gas": "3000000000000",
  "deposit": "0"
}
```

- `contractId` — the greeting contract's account id. the tool box
  resolves it per network: `greeting_contractid("mainnet")` is
  `hello.sleet.near`, `greeting_contractid("testnet")` is
  `hello.sleet.testnet`.
- `method` — the method name, exactly as the contract spells it.
- `args` — the contract's own argument object. for `set_greeting` it
  is `{ greeting }` and nothing else.
- `gas` — the gas, as a raw digit string of gas units. `3000000000000`
  is 3 Tgas.
- `deposit` — the attached native NEAR, as a raw digit string of
  yoctoNEAR. `0` here — the contract takes no deposit.

the payload for each write method:

| method | args | gas | deposit |
| --- | --- | --- | --- |
| `set_greeting` | `{ greeting }` | 3 Tgas | 0 |

`gas` and `deposit` are raw digit strings here. the web app's
`shared/gas_deposit.ts` also accepts near-kit's human forms —
`"3 Tgas"`, `"1 yocto"` — and converts them, so a hand-written payload
may use either. raw digits are preferred, because there is no
ambiguity about what they mean.

---

#### THE FLOW

1. read the current greeting if the user has not told you what it says
2. explain the change in one sentence
3. prepare the queue payload with `bin/greeting.ts set`
4. queue it with the general skill's `queue_tx.ts`
5. report the queue id and that it waits for a signature

---

#### THE BIN

```sh
# read
bun bin/greeting.ts get

# prepare
bun bin/greeting.ts set --greeting "Hello from the agent"

# testnet
bun bin/greeting.ts get --network testnet
bun bin/greeting.ts set --greeting "Hello" --network testnet
```

the bin prints JSON on stdout and JSON errors on stderr with a
non-zero exit code.

the `set` command does not queue anything by itself — it prints the
queue payload to queue. that keeps the preparation and the queueing
steps separate, and the human sees the same payload either way.

---

#### EXAMPLE

```sh
bun bin/greeting.ts set --greeting "Hello from sleet"
```

```json
{
  "ok": true,
  "action": "queue_set_greeting",
  "transaction": {
    "contractId": "hello.sleet.near",
    "method": "set_greeting",
    "args": { "greeting": "Hello from sleet" },
    "gas": "3000000000000",
    "deposit": "0"
  }
}
```

then queue it:

```sh
bun ../../shit-1170-rex-engine/bin/queue_tx.ts \
  --transactions '[{"contractId":"hello.sleet.near","method":"set_greeting","args":{"greeting":"Hello from sleet"},"gas":"3000000000000","deposit":"0"}]' \
  --what "Set the greeting to Hello from sleet"
```

---

#### WHEN NOT TO USE THIS SKILL

- a contract that merely mentions a greeting: check its own ABI first
- a batch that also does other things: the general skill's
  `queue_tx.ts` takes a list of calls, and this skill only describes
  the greeting one

=====================
<br/>
copyright 2026 by sleet.near
