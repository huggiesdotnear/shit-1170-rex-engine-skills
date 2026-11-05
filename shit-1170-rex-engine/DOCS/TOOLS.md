# TOOLS

the sources used by the shit-1170 rex engine skill.

this file is scoped to the engine skill. for the whole library — every
skill, every published package, and the tool box sources — see the
library's [TOOLS.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/DOCS/TOOLS.md).

---

#### SHIT-1170 REX ENGINE

the engine's own backend and its typed client.

- live site: <https://shit-1170.com/>
- code: <https://github.com/huggiesdotnear/shit-1170-rex-engine>
- npm: `@huggies/shit-1170-rex-engine-middleman`
- docs: <https://github.com/huggiesdotnear/shit-1170-rex-engine/tree/master/DOCS>

the middleman package is the source of truth for the engine's own
routes. it exposes one function per route and one type per request and
response shape. the bins in this skill call it, so the shapes they send
are the shapes the server accepts.

the engine's routes:

| route | what it does |
| --- | --- |
| `GET /api/shit-1170/ping` | liveness |
| `POST /api/shit-1170/api-keys` | exchange signed messages for API keys |
| `GET /api/shit-1170/api-key/me` | which account a key belongs to |
| `POST /api/shit-1170/api-key/rotate` | issue a new key for an account |
| `GET /api/shit-1170/tx-queue` | the filterable list of queued batches |
| `POST /api/shit-1170/tx-queue` | queue a batch of function calls |
| `GET /api/shit-1170/tx-queue/{queue_id}` | one queued batch |
| `POST /api/shit-1170/tx-queue/{queue_id}/accounts` | add your own account |
| `DELETE /api/shit-1170/tx-queue/{queue_id}/accounts/{account_id}` | remove your own account |
| `POST /api/shit-1170/tx-queue/{queue_id}/sent` | report sent hashes and outcomes |
| `GET /api/shit-1170/tx-queue/facets` | contracts and accounts with queued work |
| `GET /api/shit-1170/tx-queue/stats/contracts` | queued call counts per contract |
| `GET /api/shit-1170/tx-queue/stats/methods` | queued call counts per method |
| `GET /api/shit-1170/swap-queue` | the filterable list of queued swaps |
| `POST /api/shit-1170/swap-queue` | queue a swap |
| `GET /api/shit-1170/swap-queue/{swap_id}` | one queued swap |
| `POST /api/shit-1170/swap-queue/{swap_id}/accounts` | add your own account |
| `DELETE /api/shit-1170/swap-queue/{swap_id}/accounts/{account_id}` | remove your own account |
| `POST /api/shit-1170/swap-queue/{swap_id}/sent` | report the send |
| `GET /api/trezu/user/treasuries` | the Sputnik DAOs an account belongs to |

the API key travels in the `x-api-key` header. `x-session-token` is the
legacy name and is still accepted.

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

the tool box packages are v0.3.0.

`@near-kit-tool-box/fun` is the read side: one helper per contract
method, each one a VIEW call. `generic_contract_view_fun_json` is the
generic reader for the methods that have no dedicated helper yet.

`@near-kit-tool-box/env` is the client setup for server-side scripts.
it reads `NEAR_KIT_NETWORK` from the environment and defaults to
**testnet**. this skill defaults to **mainnet**, so it builds the
client itself with `new Near({ network })` from the `near-kit`
package (the tool box depends on `near-kit` ^0.20.2) rather than
using the env package's default client.

`@near-kit-tool-box/web` is the BROWSER-wallet variant: it needs a
browser wallet and `localStorage`. the frontend uses it. this skill does
not — a skill bin runs in a terminal, has no wallet, and must never
sign anything.

the rex engine does not proxy the third-party APIs. the browser and the
bins call them directly.

---

#### INTEAR API

the token registry, balances, and holders behind most of the engine's
pages.

- base url: `https://api.intea.rs`
- docs: <https://docs.intear.tech/api/>
- every docs page is also markdown: append `.md` to the page url
- everything at once: <https://docs.intear.tech/api/llms-full.txt>

the endpoints this skill uses:

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

`near contract inspect` reports the build the account runs, not the
newest build. check each account you intend to call.

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

the contract reference skills this library is sourced from.

- <https://github.com/sleetplayground/near-kit-tool-box-skills>

they document each contract's methods, argument shapes, gas, and
deposits. read the matching skill before queuing a call to a contract
the engine does not own.

---

#### INTEAR DEX SOURCE

the INTEAR DEX runs its sub-dexes as WASM inside one account, so the
contract's own ABI does not show the sub-dex methods.

- <https://github.com/INTEARnear/dex>

`src/lib.rs` is the engine. `dexes/xyk`, `dexes/otc`, `dexes/simple-amm`,
and `dexes/minimal` are the venues.

---

#### DOCS

- NEAR: <https://docs.near.org/>
- FastNear: <https://docs.fastnear.com/>
- Intear: <https://docs.intear.tech/>

=====================
<br/>
copyright 2026 by sleet.near
