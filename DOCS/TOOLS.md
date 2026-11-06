# TOOLS

the sources and the clients the shit-1170 rex skills use.

this file is scoped to the whole library. the engine skill's own routes
and data model are in its
[ENGINE.md](../shit-1170-rex-engine/DOCS/ENGINE.md).

---

#### SHIT-1170 REX ENGINE

the engine's backend and its typed client.

- live site: <https://shit-1170.com/>
- code: <https://github.com/huggiesdotnear/shit-1170-rex-engine>
- npm: `@huggies/shit-1170-rex-engine-middleman`
- engine docs: <https://github.com/huggiesdotnear/shit-1170-rex-engine/tree/master/DOCS>

the middleman package is the source of truth for the engine's own
routes. it exposes one function per route and one type per request and
response shape. the bins call it, so the shapes they send are the
shapes the server accepts.

---

#### SLEET JS MIDDLEMAN PACKAGES

each public API has its own typed client, so there is one place to keep
it and one place to change it.

- `@huggies/shit-1170-rex-engine-middleman` — `https://shit-1170.com`
- `@sleet-js/middleman-intear-api` — `https://api.intea.rs`
- `@sleet-js/middleman-intear-dex-api` — `https://dex-backend.intear.tech`
- `@sleet-js/middleman-rhea-api` — `https://api.rhea.finance`
- `@near-kit-tool-box/fun` — typed, Zod-validated NEAR contract helpers
- `@near-kit-tool-box/env` — the server-side NEAR KIT client setup

the middleman also holds the tool primitives every bin uses: the
argument parsing and the JSON printing. they live there because the
middleman is what makes stdout noisy — it logs every request and
response with `console.log` — so the quieting and the printing belong
next to the logging that makes them necessary.

`@near-kit-tool-box/fun` is the read side: one helper per contract
method, each one a VIEW call. `generic_contract_view_fun_json` is the
generic reader for the methods that have no dedicated helper yet.

`@near-kit-tool-box/env` is the client setup for server-side scripts.
it reads `NEAR_KIT_NETWORK` from the environment and defaults to
**testnet**. the skills default to **mainnet**, so they build the
client themselves with `new Near({ network })` from the `near-kit`
package (the tool box depends on `near-kit` ^0.20.2) rather than
using the env package's default client.

`@near-kit-tool-box/web` is the BROWSER-wallet variant: it needs a
browser wallet and `localStorage`. the frontend uses it. the skills do
not — a skill bin runs in a terminal, has no wallet, and must never
sign anything.

the rex engine does not proxy the third-party APIs. the browser and the
bins call them directly.

**the skills in this library are NOT published to npm.** they are
consumed with the skills installer, straight from the repo:

```sh
bunx skills add huggiesdotnear/shit-1170-rex-engine-skills
```

the `package.json` in each skill folder names the package the folder
*would* have if it were published — `@huggies/shit-1170-rex-engine-skill`
and its three siblings. those names are internal. nothing is on the
npm registry, and nothing needs to be: the installer takes the repo.

the middleman is a different thing — it IS published, because code
outside this repo imports it.

---

#### INTEAR API

the token registry, balances, and holders behind most of the engine's
pages.

- base url: `https://api.intea.rs`
- docs: <https://docs.intear.tech/api/>
- every docs page is also markdown: append `.md` to the page url
- everything at once: <https://docs.intear.tech/api/llms-full.txt>

the endpoints this library uses:

| endpoint | what it answers |
| --- | --- |
| `GET /tokens` | token metadata by id, with fields and paging |
| `GET /tokens/search` | token search |
| `GET /balances` | one account's balances, by source and token |
| `GET /holders` | one token's holders, cursor-paged |

---

#### NEAR RPC

the chain itself. the bins use it to verify that an account exists and
to call view methods.

the bins do NOT hand-roll that request — they use `near-kit` through
`@near-kit-tool-box/fun`, which builds the request correctly and
validates the answer.

> `rpc.mainnet.near.org` and `rpc.testnet.near.org` are **deprecated**.
> they answer `429 "THIS ENDPOINT IS DEPRECATED!"` for every request.
> the working public endpoints are `rpc.mainnet.fastnear.com` and
> `rpc.testnet.fastnear.com`, and near-kit uses those by default.

---

#### NEAR CLI

the authoritative method list of a deployed contract:

```sh
near contract inspect <contract_id> network-config mainnet now
```

---

#### FASTNEAR TRANSACTIONS API

read-only JSON over transactions, blocks, and receipts.

- mainnet: <https://tx.main.fastnear.com/>
- testnet: <https://tx.test.fastnear.com/>

the root of either host serves the endpoint reference. use it to confirm
that a transaction the human sent actually landed and what happened to
it.

---

#### NEAR-KIT TOOL BOX SKILLS

the contract reference skills this library is written against.

- <https://github.com/sleetplayground/near-kit-tool-box-skills>

they document each contract's methods, argument shapes, gas, and
deposits. read the matching skill before queuing a call to a contract
the engine does not own.

the tool boxes themselves:

- <https://github.com/sleet-js/near-kit-tool-box-ts>
- <https://github.com/sleet-rs/near-kit-tool-box-rs>

**where a fact comes from, and how strong it is.**

| source | what it is | how strong |
| --- | --- | --- |
| a **fun helper** in the TS or RUST tool box | the function that builds and sends the exact JSON | strongest — it proves the argument shape, the gas, and the deposit |
| a **typed contract** in the RUST tool box | a hand-written wrapper | weaker — it has been wrong once, so check it before use |
| the **skill library** | the written reference per contract | the reference to write against; the tool boxes win on a disagreement |
| `near contract inspect` | the deployed build's own ABI | authoritative for the method list |

a fun helper proves the **shape** of the arguments, not that the
method exists. near-sdk only exports methods inside a `#[near]` impl
block — a plain `pub fn` on the contract is not callable — so check
the contract's own method list before documenting a method as
callable. a fact in none of these is recorded as **not documented
yet**, never guessed.

`near contract inspect` reports the build that account runs, not the
newest build, so check each account you intend to call.

---

#### INTEAR DEX SOURCE

the INTEAR DEX runs its sub-dexes as WASM inside one account, so the
contract's own ABI does not show the sub-dex methods.

- <https://github.com/INTEARnear/dex>

`src/lib.rs` is the engine. `dexes/xyk`, `dexes/otc`, `dexes/simple-amm`,
and `dexes/minimal` are the venues. a sub-dex view is reached through
`dex_view`, whose arguments are borsh-encoded and base64-wrapped.

---

#### DOCS

- NEAR: <https://docs.near.org/>
- FastNear: <https://docs.fastnear.com/>
- Intear: <https://docs.intear.tech/>

=====================
<br/>
copyright 2026 by sleet.near
