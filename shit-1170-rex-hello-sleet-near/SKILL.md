---
name: shit-1170-rex-hello-sleet-near
description: "Read the hello.sleet.near greeting contract on mainnet and testnet with the shit-1170 rex engine — the deployed contract ids, each method's call type, exact argument shape, and gas and deposit. Use this skill whenever the user mentions hello.sleet.near, hello.sleet.testnet, the sleet greeting contract, get_greeting, set_greeting, or wants to read the current greeting or set a new one — including when they want to know what arguments a greeting contract method takes, or need the greeting contract's id for the right network. Also use it when a queued transaction calls the greeting contract and the agent must check the method name, the arguments, the gas, or the deposit. Emit a queue payload for a human to sign; never send it yourself."
---

# shit-1170 rex hello.sleet.near

the hello.sleet.near greeting contract.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture:
<https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>.
this skill holds the contract's methods and arguments.

**the rules that apply here too:** the agent never calls a contract — a
read goes to the near-kit tool box, a write emits a QUEUE PAYLOAD for a
human to sign. the engine skill states the rule in full:
<https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>.

---

#### CONTRACT IDS

- MAINNET: `hello.sleet.near`
- TESTNET: `hello.sleet.testnet`

the network decides the id. the testnet contract is a different
contract, not a copy of the mainnet one — a call to the wrong one
fails with `MethodResolveError`.

the tool box resolves it per network: `greeting_contractid("mainnet")`
is `hello.sleet.near`, `greeting_contractid("testnet")` is
`hello.sleet.testnet`.

---

#### THE METHODS

### get_greeting - VIEW

no arguments. gas: none — a view call is read-only. attached
deposit: 0.

answers with the current greeting, as a plain string. the tool box
helper is `greeting_get_greeting_fun_json`, and
`generic_contract_view_fun_json` is the escape hatch for views that
have no dedicated helper.

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

#### THE WRITE PAYLOAD

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

`contractId` is the greeting contract's account id for the network.
`method` is the method name, exactly as the contract spells it. `args`
is the contract's own argument object — for `set_greeting` it is
`{ greeting }` and nothing else. `gas` and `deposit` are raw digit
strings — gas units and yoctoNEAR. `3000000000000` is 3 Tgas, and
`0` here because the contract takes no deposit.

the web app's `gas_deposit.ts` also accepts near-kit's human
forms (`"3 Tgas"`, `"1 yocto"`) and converts them, so a hand-written
payload may use either. raw digits are preferred, because there is no
ambiguity about what they mean.

---

#### THE FLOW

1. read the current greeting if the user has not told you what it says
2. explain the change in one sentence
3. prepare the queue payload with `bin/greeting.ts set`
4. queue it with the general skill's `queue_tx.ts`
5. report the queue id, the link to sign it, and that it waits for a
   signature

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

an example, then the queueing:

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

```sh
# the queueing bins live in the general shit-1170-rex-engine skill:
# https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md
bun ../shit-1170-rex-engine/bin/queue_tx.ts \
  --transactions '[{"contractId":"hello.sleet.near","method":"set_greeting","args":{"greeting":"Hello from sleet"},"gas":"3000000000000","deposit":"0"}]' \
  --what "Set the greeting to Hello from sleet"
```

---

#### WHEN NOT TO USE THIS SKILL

- a contract that merely mentions a greeting: check its own ABI first
- a batch that also does other things: the general skill's
  `queue_tx.ts` takes a list of calls, and this skill only describes
  the greeting one

---

#### MORE

- the engine skill for the queueing mechanics:
  <https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>

=====================
<br/>
copyright 2026 by sleet.near
