---
name: shit-1170-rex-sputnik-dao
description: Prepare Sputnik DAO governance calls with the shit-1170 rex engine — reading a DAO's config, policy, proposals and bounties, and queueing add_proposal, act_proposal (vote, finalize, remove) and the bounty actions for a human to sign. Use this skill whenever the user mentions Sputnik DAO, sputnik-dao.near, a dao account like huggies.sputnik-dao.near or onsocial.sputnik-dao.near, get_policy, get_proposals, add_proposal, act_proposal, proposal_bond, bounty_bond, VoteApprove, a DAO vote, a DAO proposal, or the DAO treasury — including when they want to propose something to a DAO, vote on a proposal, claim a bounty, or find out what a DAO's policy allows an account to do. Reads go to the near-kit tool box; writes emit a queue payload for a human to sign; never send it yourself.
---

# shit-1170 rex Sputnik DAO

the Sputnik DAO V2 governance contracts, as the rex engine needs them:
the reads the bins make, and the queue payloads an agent hands to a
human to sign.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture. this skill holds the DAO-specific
parts.

**the rules that apply here too:** the agent never calls a contract. a
read goes to the near-kit tool box (`@near-kit-tool-box/fun`); a write
emits a QUEUE PAYLOAD for the engine to queue for a human to sign.
never `near.call`, never `generic_contract_call_fun`, never
`generic_contract_call_wallet`.

---

#### THE TWO CONTRACTS

there are two kinds of account and they are not interchangeable.

the **factory** is `sputnik-dao.near` on mainnet and
`sputnikv2.testnet` on testnet. it deploys the daos and keeps the list
of them. it holds no dao state.

a **dao** is `<name>.sputnik-dao.near` on mainnet and
`<name>.sputnikv2.testnet` on testnet — `huggies.sputnik-dao.near`,
`onsocial.sputnik-dao.near`, `sleet.sputnik-dao.near`.

calling the factory as if it were a dao fails with
`MethodResolveError(MethodNotFound)` for **every** dao method. the
error says "method not found", not "wrong contract".

**the factory is not a dao** — so a dao call is always addressed to
`<name>.sputnik-dao.near`, never to `sputnik-dao.near`.

---

#### THE POLICY DECIDES THREE THINGS

this is the part that decides whether a call succeeds, and it is read
before anything is queued.

**the DEPOSIT.** `add_proposal` and `act_proposal` need a deposit
equal to the DAO's own `proposal_bond`, read from `get_policy`. the
contract checks it with EQUALITY, so a deposit that is too large fails
the same way a small one does. the bond is a per-dao value:
`huggies.sputnik-dao.near` has one of `0`,
`onsocial.sputnik-dao.near` has `100000000000000000000000`. never
hardcode a bond — read it.

`bounty_claim` needs the DAO's `bounty_bond`. `bounty_done` needs the
`proposal_bond`, because it creates a proposal. `bounty_giveup` and
`act_proposal` need 0.

**the PERMISSION.** a permission is written
`<proposal kind>:<action>`. the prefix is the kind of the **proposal**,
not the method being called — `call:VoteApprove` approves a
`FunctionCall` proposal and `transfer:VoteApprove` approves a
`Transfer` one.

the contract matches on any of four forms:

| form | grants |
| --- | --- |
| `<kind>:<action>` | that action on that kind of proposal |
| `<kind>:*` | every action on that kind of proposal |
| `*:<action>` | that action on any kind of proposal |
| `*:*` | everything |

the kind's label is not always its name:

| kind | label |
| --- | --- |
| `FunctionCall` | `call` |
| `ChangeConfig` | `config` |
| `ChangePolicy` | `policy` |
| `Vote` | `vote` |
| `Transfer` | `transfer` |
| `SetStakingContract` | `set_vote_token` |
| `AddBounty` | `add_bounty` |
| `BountyDone` | `bounty_done` |

`AddProposal` is the action the `add_proposal` call itself is checked
against. so to propose a `FunctionCall` a role needs `call:AddProposal`
— not `function_call:AddProposal`.

**the THRESHOLD.** the roles whose `vote_policy` covers the proposal's
kind are the ones whose votes count, and the threshold is measured
against the **role**, not the person. a role's own `vote_policy`
threshold overrides the DAO's `default_vote_policy` for that role. the
default threshold is a `[for, against]` pair; a role's own is a plain
count.

**the votes are counted per role.** a vote counts once for **each** of
the voter's roles that permits the action on that proposal's kind — so
an account in two permitting roles is counted twice, once under each
role. the roles are what the threshold is measured against, not the
people.

a role of kind `Everyone` is skipped when the threshold is worked out:
it has no members to count, so it never carries a threshold of its own.
an account in such a role can still hold permissions and vote.

---

#### THE READS

all of these are views. they need no key and no engine account, and
they change nothing on the chain.

| bin | what it reads |
| --- | --- |
| `dao_info.ts` | the config, the version, the available and locked amounts, the factory |
| `dao_policy.ts` | the policy, and what this account may do under it |
| `dao_proposals.ts` | a page of proposals, and optionally the actions log |
| `dao_bounties.ts` | the bounties, one bounty, or an account's claims |

`dao_info.ts` also answers the two amounts that matter for a
treasury:

- `availableAmount` — the NEAR the DAO can spend, in yoctoNEAR. the
  balance minus the protocol storage cost and minus the bonds locked
  in proposals and bounties.
- `lockedStorageAmount` — the protocol storage cost the DAO's data
  occupies, in yoctoNEAR. it is **not** the locked bond balance.

the DAO's `version` is its **crate version**, e.g. `2.3.1`. it is not
the factory's `[major, minor]` build number — a DAO on the `[3,1]`
build answers `2.3.1` too. to know the build, read the DAO's code
hash and match it against the factory's `get_contracts_metadata`.

---

#### THE WRITES

every write produces a QUEUE PAYLOAD — data, not an action. the engine
queues it and a human signs it.

| bin | method | deposit | gas |
| --- | --- | --- | --- |
| `add_proposal.ts` | `add_proposal` | the DAO's `proposal_bond` | 30 Tgas |
| `act_proposal.ts` | `act_proposal` | 0 | 30 Tgas |
| `bounty.ts` | `bounty_claim` | the DAO's `bounty_bond` | 30 Tgas |
| `bounty.ts` | `bounty_done` | the DAO's `proposal_bond` | 30 Tgas |
| `bounty.ts` | `bounty_giveup` | 0 | 30 Tgas |

the gas and the deposit come from the toolbox's
`sputnik_dao_*_fun_json` call helpers, which build and send the exact
JSON — so they are the strongest evidence for the shape.

**the proposal kind is an externally tagged enum** — an object with one
key and the payload under it:

```json
{ "Vote": null }
```

```json
{
  "Transfer": {
    "token_id": "",
    "receiver_id": "sleet.near",
    "amount": "1000000000000000000000000",
    "msg": null
  }
}
```

```json
{
  "FunctionCall": {
    "receiver_id": "social.near",
    "actions": [
      {
        "method_name": "some_method",
        "args": "eyJmb28iOiJiYXIifQ==",
        "deposit": "0",
        "gas": "30000000000000"
      }
    ]
  }
}
```

**a `FunctionCall` action's `args` are base64-encoded bytes.** the
contract stores them raw, so a plain JSON object is rejected. `deposit`
and `gas` are decimal strings in yoctoNEAR and yoctoGas.

**a NEAR transfer carries a null `msg`.** an empty `token_id` means
NEAR, and a non-null `msg` with an empty `token_id` fails with
`ERR_BASE_TOKEN_NO_MSG`. the bin refuses that combination before it
queues anything.

---

#### ADDING A PROPOSAL

the flow, and the bins to run at each step:

1. **read the policy** — `bin/dao_policy.ts --dao <dao> --account <account> --kind <Kind>`.
   it answers the bond to deposit, the roles the account holds, and
   whether the account may propose that kind at all.
2. **explain it** — the DAO, the kind of proposal, the payload, the
   deposit and what it does.
3. **prepare it** — `bin/add_proposal.ts`. it re-reads the policy when
   `--account` is given, so the deposit in the payload is the DAO's own
   bond rather than a guess.
4. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`.

```sh
bun bin/dao_policy.ts --dao onsocial --account greenghost.near --kind FunctionCall
bun bin/add_proposal.ts --dao onsocial \
  --description "Call the target contract" \
  --kind call \
  --receiver social.near \
  --method some_method \
  --args-base64 "eyJmb28iOiJiYXIifQ==" \
  --account greenghost.near
```

`--kind` builds the common kinds so the nesting is not hand-written:
`vote`, `transfer`, `call`, `add-member`, `remove-member`. `--kind-json`
takes the kind object directly, for the kinds the bin does not build.

---

#### VOTING ON A PROPOSAL

**the kind must be the proposal's stored kind, unchanged.** the
contract compares the `proposal` argument against the kind stored for
that id and rejects a mismatch with `ERR_WRONG_KIND`. it must be the
**whole** payload, not just the label — for a `Transfer` that is the
`token_id`, `receiver_id`, `amount` and `msg` as they are stored.

so the bin **reads the proposal and takes its kind from there**. that
is the only way to get it right, and it is why there is no `--kind`
flag on `act_proposal.ts`.

the action is one of `VoteApprove`, `VoteReject`, `VoteRemove`,
`Finalize`, `RemoveProposal` or `MoveToHub`. `AddProposal` is not
accepted — the contract rejects it with `ERR_WRONG_ACTION`.

`RemoveProposal` deletes the proposal from storage. `MoveToHub` is
accepted but is a no-op. `Finalize` on a proposal that is neither
expired nor failed fails with `ERR_PROPOSAL_NOT_EXPIRED_OR_FAILED`.
voting twice fails with `ERR_ALREADY_VOTED`.

```sh
bun bin/dao_policy.ts --dao huggies --account sleet.near --kind Transfer --action VoteApprove
bun bin/act_proposal.ts --dao huggies \
  --proposal-id 1 \
  --action VoteApprove \
  --account sleet.near
```

**the deposit on `act_proposal` is 0.** only `add_proposal` and
`bounty_done` are bonded.

---

#### THE BOUNTIES

a bounty is a pot of tokens the DAO offers for a task. the amount is
in the token's own smallest unit, and the contract does not say how
many decimals that is. NEAR is 24 and most other tokens are 18, so
read the decimals from the token registry — never from a guess. an
empty `token_id` means NEAR.

three actions:

| action | what it does | the deposit |
| --- | --- | --- |
| `bounty_claim` | claim the bounty to do the task | the DAO's `bounty_bond` |
| `bounty_done` | mark the claim complete — this creates a proposal | the DAO's `proposal_bond` |
| `bounty_giveup` | give the claim up and take the bond back | 0 |

`bounty_claim`'s `deadline` is a duration in **nanoseconds** and must
not exceed the bounty's `max_deadline`. read the bounty first with
`bin/dao_bounties.ts --bounty-id <n>`.

`bounty_done`'s `account_id` may be null to mean the caller. when it
is not null it names the claim owner, and the caller must be that owner
while the claim is still active — otherwise it fails with
`ERR_BOUNTY_DONE_MUST_BE_SELF`. once the claim has expired, anyone
may call it to free the claim slot.

`bounty_giveup` returns the bond within the DAO's forgiveness period
and forfeits it after. the period is measured from the claim's
`start_time`.

```sh
bun bin/dao_bounties.ts --dao <dao> --bounty-id 0
bun bin/bounty.ts --dao <dao> --bounty-id 0 --action claim \
  --deadline 3600000000000 --account <account>
```

---

#### THE FLOW

1. **read the policy** — `bin/dao_policy.ts`. the bond, the
   permissions, the thresholds.
2. **read the proposal** — `bin/dao_proposals.ts` or
   `bin/dao_bounties.ts`. the stored kind, the status, the votes so
   far.
3. **explain it** — the DAO, the method, the arguments, the gas, the
   deposit, and what it will do.
4. **prepare it** — `bin/add_proposal.ts`, `bin/act_proposal.ts` or
   `bin/bounty.ts`. these print the queue payload and send nothing.
5. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`, and report the queue id and the link to sign it.
6. **wait, then follow it** — the general skill's `watch_queue.ts
   --queue <id> --until sent`, then `queue_sent.ts --from-server` for
   the hash and `tx_status.ts` for the outcome.

---

#### THE BINS

| bin | what it does |
| --- | --- |
| `dao_info.ts` | a DAO's config, version, available and locked amounts, factory |
| `dao_policy.ts` | the policy, and what this account may do under it |
| `dao_proposals.ts` | a page of proposals, and optionally the actions log |
| `dao_bounties.ts` | the bounties, one bounty, or an account's claims |
| `add_proposal.ts` | prepare an `add_proposal` queue payload |
| `act_proposal.ts` | prepare an `act_proposal` queue payload |
| `bounty.ts` | prepare a `bounty_claim`, `bounty_done` or `bounty_giveup` queue payload |

all of them print JSON on stdout and JSON errors on stderr with a
non-zero exit code.

`add_proposal.ts` and `bounty.ts` take `--account` — the account that
will sign. with it they read the policy and take the deposit from the
DAO's own bond. without it you must pass `--deposit` yourself.

`act_proposal.ts` takes `--dao`, `--proposal-id`, `--action` and
optionally `--memo` and `--account`. it reads the proposal's kind from
the chain.

---

#### WHEN NOT TO USE THIS SKILL

- a swap or a token transfer through the engine's own queues: use the
  general skill's `queue_swap.ts` and the `shit-1170-rex-ft` skill.
- the DAO's own factory calls — creating a DAO, storing a contract,
  pushing an update: the factory is a different contract, and the
  engine has no business deploying one.
- a DAO's own private callbacks — `on_proposal_callback`, `migrate`,
  `new`: the contract calls those, not a human.
- another DAO implementation. this skill is Sputnik DAO V2.

---

#### MORE

- [SPUTNIK.DAO.md](./DOCS/SPUTNIK.DAO.md) — the full method reference:
  every view and every call, with the argument shape, the gas and the
  deposit

=====================
<br/>
copyright 2026 by sleet.near
