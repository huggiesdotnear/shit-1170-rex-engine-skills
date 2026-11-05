# shit-1170-rex-engine-skills

this is a skill library for shit-1170-rex-engine

- see skill list in [README.md](./README.md)
- see live site at 🌐 https://shit-1170.com/
- see code at 🐱 https://github.com/huggiesdotnear/shit-1170-rex-engine
- see general skills for interacting with near smart contracts at 🐱 https://github.com/sleetplayground/near-kit-tool-box-skills

---

#### GIT

`git pull` before you start, commit and push to `main` when you are done.

never create a branch. work on `main` and push it.

---

#### WHERE A SKILL'S FACTS COME FROM

the skills here are sourced from the near kit tool boxes. three repos,
three different strengths of evidence:

- 🐱 https://github.com/sleet-js/near-kit-tool-box-ts — **the TS tool box.** `packages/fun` holds the reusable
  functions, and the method constants, contract id constants, and
  shared types sit alongside them. a **fun helper is the strongest
  evidence**: it builds and sends the exact JSON, so it proves the
  shape of the arguments, the gas, and the deposit.
- 🐱 https://github.com/sleet-rs/near-kit-tool-box-rs — **the RUST tool box.** `src/fun` holds the reusable
  functions, `src/bin` the example bins, `src/lib/contract` the typed
  contracts, `src/lib/methods` the method name constants,
  `src/lib/const_id` the contract id constants, and `src/lib/types`
  the shared response and data shapes. a **typed contract is weaker
  evidence** — it is hand-written and has been wrong once — so
  anything taken from one is marked as unconfirmed and should be
  checked before use.
- 🐱 https://github.com/sleetplayground/near-kit-tool-box-skills — **the skill library.** one folder per
  contract, holding the contract id per network and each method's
  call type, argument shape, gas, and attached deposit. this is the
  general reference these skills are written against, and where the
  two tool boxes disagree with it, the tool boxes win.

when a fact is in none of them, record it as **not documented yet**
rather than guessing.

**verify before writing it down.** check the method against the
deployed contract:

```sh
near contract inspect <contract_id> network-config mainnet now
```

`near contract inspect` reports the build that account runs, not the
newest build, so check each account you intend to call. daos
deployed from the same factory can sit on different builds.

**a fun helper proves the shape of the arguments, not that the
method exists.** near-sdk only exports methods inside a `#[near]`
impl block — a plain `pub fn` on the contract is not callable. check
the contract's own method list before documenting a method as
callable.

**keep the two tool boxes in sync.** when a contract method changes,
both the TS and the RUST tool box change with it, and the skill
library follows.

**the repo should only contain truth.** when adding or fixing
something, do not say what the lie or the misconception was — only
have what is true about a contract and its methods and how to
interact with it.

---

#### HOW A SKILL USES THE TOOL BOX

**reads go to the tool box directly.** a view call is a read: the
skill calls the near-kit tool box itself, with no key and no engine
account. `@near-kit-tool-box/fun` holds the typed helpers and
`generic_contract_view_fun_json` is the escape hatch for a view that
has no dedicated helper. `@near-kit-tool-box/env` is the
server-side client setup, but the skills build their own client with
`new Near({ network })` from `near-kit`, because the env package
defaults to testnet and these skills default to mainnet.

**writes go to the queue, not to the tool box.** the agent never
calls a contract. a state-changing call becomes a QUEUE PAYLOAD —
`{ contractId, method, args, gas, deposit }` — and the engine holds
it for a human to sign in the web app with their wallet. the skill
builds the payload with the queue helpers (`queue_tx.ts`,
`queue_swap.ts`) and the tool box's `*_fun_json` helpers that CALL
are reference only: use their argument shape, gas, and deposit, but
emit a queue payload instead of sending.

so the tool box supplies the **facts** — the argument shape, the gas,
the deposit — and the queue helpers carry the **action**. never
`near.call`, never `generic_contract_call_fun`, never
`generic_contract_call_wallet`.

---

#### AGENT WORKFLOW

follow the same order every time, so a task that crosses contracts
does not change shape halfway through:

1. **find out** — read the contract, the chain, and the engine's
   state before deciding what to propose.
2. **prove it** — verify the method, the arguments, the gas, the
   deposit, the account, the receiver, and the amount.
3. **explain it** — say what the calls do in plain language before
   queueing them.
4. **queue it** — write the batch to the engine, for a human to
   sign.
5. **keep a copy** — the local record under
   `${HOME}/.shit-1170-rex-engine/` is the backup and the history.
6. **follow it** — sync the local record with the server after the
   human sends, and read the receipt on chain.

steps 2 and 3 are what make the skill worth using. the engine records
whatever it is given, so an agent that queues without verifying can
queue a call that moves the wrong amount to the wrong place.

=====================
<br/>
copyright 2026 by sleet.near
