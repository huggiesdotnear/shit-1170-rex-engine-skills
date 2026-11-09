# shit-1170-rex-sputnik-dao

Sputnik DAO governance for the shit-1170 rex engine.

read a DAO's config, policy, proposals and bounties, and queue a
proposal, a vote or a bounty action for a human to sign.

see [SKILL.md](./SKILL.md) for the overview and the flow.

---

#### THE BINS

```sh
bun bin/dao_info.ts --dao <name|account_id>
bun bin/dao_policy.ts --dao <name|account_id> --account <account_id> [--kind <Kind>] [--action <Action>]
bun bin/dao_proposals.ts --dao <name|account_id> [--from-index 0] [--limit 50] [--actions-log]
bun bin/dao_bounties.ts --dao <name|account_id> [--bounty-id <n>] [--claims <account_id>]

bun bin/add_proposal.ts --dao <name|account_id> --description <text> --kind vote --account <account_id>
bun bin/act_proposal.ts --dao <name|account_id> --proposal-id <n> --action VoteApprove [--account <account_id>]
bun bin/bounty.ts --dao <name|account_id> --bounty-id <n> --action claim|done|giveup [--account <account_id>]
```

every bin prints JSON on stdout and JSON errors on stderr with a
non-zero exit code.

---

#### THE TWO CONTRACTS

the **factory** is `sputnik-dao.near` on mainnet and
`sputnikv2.testnet` on testnet. it deploys the daos and lists them.

a **dao** is `<name>.sputnik-dao.near` on mainnet and
`<name>.sputnikv2.testnet` on testnet — `huggies.sputnik-dao.near`,
`onsocial.sputnik-dao.near`, `sleet.sputnik-dao.near`.

the factory holds no dao state, and calling it as if it were a dao
fails with `MethodResolveError(MethodNotFound)` for every dao method.

---

#### THE POLICY CHECK

`dao_policy.ts` is the bin to run before anything is queued. it reads
`get_policy` and answers the three things that decide whether a call
succeeds:

- the **deposit** — the DAO's own `proposal_bond`. the contract checks
  it with equality, so too much fails the same way too little does.
  the bond is a per-dao value: `huggies.sputnik-dao.near` has one of
  `0`, `onsocial.sputnik-dao.near` has `100000000000000000000000`.
- the **permission** — a permission is written
  `<proposal kind>:<action>`, and the prefix is the kind of the
  proposal. `call:VoteApprove` approves a `FunctionCall` proposal.
  the contract also matches `<kind>:*`, `*:<action>` and `*:*`.
- the **threshold** — the roles whose `vote_policy` covers the
  proposal's kind are the ones whose votes count, and the threshold is
  measured against the role.

it also says which roles the account holds, and which roles are open
to everyone.

---

#### THE PROPOSAL KIND

the kind is an externally tagged enum — an object with one key and the
payload under it. `add_proposal.ts` builds the common ones from flags,
so the nesting is never hand-written:

| `--kind` | the kind it builds |
| --- | --- |
| `vote` | `{ "Vote": null }` |
| `transfer` | `{ "Transfer": { token_id, receiver_id, amount, msg } }` |
| `call` | `{ "FunctionCall": { receiver_id, actions } }` |
| `add-member` | `{ "AddMemberToRole": { member_id, role } }` |
| `remove-member` | `{ "RemoveMemberFromRole": { member_id, role } }` |

`--kind-json` takes the kind object directly.

**a `FunctionCall` action's `args` are base64-encoded bytes.** the
contract stores them raw, so a plain JSON object is rejected.

**a NEAR transfer carries a null `msg`** — an empty `token_id` means
NEAR, and a non-null `msg` with it fails with `ERR_BASE_TOKEN_NO_MSG`.
the bin refuses that combination before it queues anything.

---

#### THE VOTE

`act_proposal.ts` reads the proposal and takes its kind from the chain.
the contract compares the `proposal` argument against the stored kind
and rejects a mismatch with `ERR_WRONG_KIND`, and it must be the whole
payload — not just the label.

the action is one of `VoteApprove`, `VoteReject`, `VoteRemove`,
`Finalize`, `RemoveProposal` or `MoveToHub`.

the deposit on `act_proposal` is 0.

---

#### THE FULL REFERENCE

the method reference, with every view and every call, is in
[SPUTNIK.DAO.md](./DOCS/SPUTNIK.DAO.md).

=====================
<br/>
copyright 2026 by sleet.near
