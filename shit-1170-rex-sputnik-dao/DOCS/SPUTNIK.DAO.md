# Sputnik DAO V2 — the full method reference

every view and every call the skill uses, with the argument shape, the
gas and the attached deposit.

the shapes come from the near-kit tool box's `sputnik_dao_*_fun_json`
helpers, which build and send the exact JSON. the gas and the deposit
below are the ones those helpers use.

---

#### THE ACCOUNTS

| | mainnet | testnet |
| --- | --- | --- |
| the factory | `sputnik-dao.near` | `sputnikv2.testnet` |
| a dao | `<name>.sputnik-dao.near` | `<name>.sputnikv2.testnet` |

the factory and a dao are different contracts with different method
sets. the mainnet factory has `contract_source_metadata` and `store`;
the testnet factory has `store_contract_self`, `remove_contract_self`
and `on_remove_contract_self`, and no `contract_source_metadata`.

calling the factory as if it were a dao fails with
`MethodResolveError(MethodNotFound)` for every dao method.

---

#### THE VIEWS

a view is a read. it needs no key, no signer and no deposit, and it
changes nothing on the chain.

| method | args | returns |
| --- | --- | --- |
| `get_config` | `{}` | the name, the purpose and the base64 metadata |
| `get_policy` | `{}` | the roles, the permissions, the vote policies, the bonds |
| `version` | `{}` | the crate version, e.g. `2.3.1` |
| `get_proposals` | `{ from_index, limit }` | a page of proposals |
| `get_proposal` | `{ id }` | one proposal |
| `get_last_proposal_id` | `{}` | the id the NEXT proposal will carry |
| `get_actions_log` | `{}` | the latest 20 actions |
| `get_bounties` | `{ from_index, limit }` | a page of bounties |
| `get_bounty` | `{ id }` | one bounty |
| `get_bounty_claims` | `{ account_id }` | an account's claims |
| `get_bounty_number_of_claims` | `{ id }` | how many times a bounty was claimed |
| `get_last_bounty_id` | `{}` | the id the NEXT bounty will carry |
| `get_available_amount` | `{}` | the NEAR the dao can spend, in yoctoNEAR |
| `get_locked_storage_amount` | `{}` | the protocol storage cost, in yoctoNEAR |
| `get_staking_contract` | `{}` | the staking contract, or `""` |
| `get_factory_info` | `{}` | the factory id and the auto-update flag |
| `delegation_balance_of` | `{ account_id }` | the account's delegated voting power |
| `delegation_balance_ratio` | `{ account_id }` | `[balance, total]` — the contract does not divide them |
| `delegation_total_supply` | `{}` | the total delegated voting power |
| `has_blob` | `{ hash }` | whether the dao holds that blob — the hash is base58 |

**the numbers are JSON numbers.** sending them as strings panics with
`invalid type: string "0", expected u64`.

**a DAO may run an older build.** the factory publishes several builds
of the DAO contract, and a DAO can be pinned to an older one. a DAO on
an older build does not have the newer views — `genesis.sputnikv2.testnet`
answers `get_config` but not `get_factory_info`. check the build with
`near contract inspect <dao> network-config <network> now` before
relying on a view.

**the page is clamped.** `get_proposals` and `get_bounties` clamp the
page to the DAO's next id, so a `limit` larger than what remains
returns fewer rows.

**the id is `id`,** not `proposal_id` or `bounty_id` — the other name
panics with `missing field 'id'`.

**`get_last_proposal_id` is the NEXT id,** not the count of the
proposals. a DAO whose proposals were all removed still reports a
non-zero id.

**`get_available_amount`** is the balance minus the protocol storage
cost and minus the bonds locked in proposals and bounties.
**`get_locked_storage_amount`** is the protocol storage cost the DAO's
data occupies — it is not the locked bond balance.

**`version` is the crate version,** not the factory's `[major, minor]`
build number. a DAO on the `[3,1]` build answers `2.3.1` too.

---

#### THE CALLS

a call is a write. the agent never makes one — it becomes a queue
payload for a human to sign.

| method | args | gas | deposit |
| --- | --- | --- | --- |
| `add_proposal` | `{ proposal: { description, kind } }` | 30 Tgas | exactly the DAO's `proposal_bond` |
| `act_proposal` | `{ id, action, proposal, memo }` | 30 Tgas | 0 |
| `bounty_claim` | `{ id, deadline }` | 30 Tgas | exactly the DAO's `bounty_bond` |
| `bounty_done` | `{ id, account_id, description }` | 30 Tgas | exactly the DAO's `proposal_bond` |
| `bounty_giveup` | `{ id }` | 30 Tgas | 0 |

### add_proposal

the kind is an externally tagged enum — an object with one key:

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

```json
{ "AddMemberToRole": { "member_id": "alice.near", "role": "council" } }
```

```json
{ "RemoveMemberFromRole": { "member_id": "alice.near", "role": "council" } }
```

**the deposit is checked with equality.** the contract asserts
`attached_deposit == policy.proposal_bond` and fails with
`ERR_MIN_BOND` when they differ — so too much fails as loudly as too
little.

the other failures:

- a `ChangePolicy` proposal whose policy is not a `Current` policy →
  `ERR_INVALID_POLICY`
- a `Transfer` with an empty `token_id` and a non-null `msg` →
  `ERR_BASE_TOKEN_NO_MSG`
- a `SetStakingContract` proposal when a staking contract is already
  set → `ERR_STAKING_CONTRACT_CANT_CHANGE`
- a proposal kind the caller's roles do not permit →
  `ERR_PERMISSION_DENIED`

### act_proposal

```json
{
  "id": 1,
  "action": "VoteApprove",
  "proposal": {
    "Transfer": {
      "token_id": "shit-1170.meme-cooking.near",
      "receiver_id": "sleet.near",
      "amount": "20135408983632000000000000",
      "msg": null
    }
  },
  "memo": null
}
```

**`proposal` must be the proposal's stored kind, unchanged.** the
contract asserts the two are equal and fails with `ERR_WRONG_KIND`
otherwise. it is the whole payload, not just the label.

**`action` is one of** `RemoveProposal`, `VoteApprove`, `VoteReject`,
`VoteRemove`, `Finalize`, `MoveToHub`. `AddProposal` is not accepted —
the contract rejects it with `ERR_WRONG_ACTION`.

`memo` is optional and only logged.

the other failures:

- voting on a proposal that is not `InProgress` →
  `ERR_PROPOSAL_NOT_READY_FOR_VOTE`
- voting twice → `ERR_ALREADY_VOTED`
- `Finalize` on a proposal that is neither expired nor failed →
  `ERR_PROPOSAL_NOT_EXPIRED_OR_FAILED`
- an action the caller's roles do not permit → `ERR_PERMISSION_DENIED`

`RemoveProposal` deletes the proposal from storage. `MoveToHub` is
accepted but is a no-op.

**the DAO only runs a `FunctionCall` proposal's call after it is
approved,** and the approval lands in the `on_proposal_callback`
receipt — not in the receipt of the vote that triggered it.

### bounty_claim

```json
{ "id": 0, "deadline": "3600000000000" }
```

`deadline` is a duration in nanoseconds and must not exceed the
bounty's `max_deadline`.

- a bounty that is not there → `ERR_NO_BOUNTY`
- claiming more times than the bounty's `times` →
  `ERR_BOUNTY_ALL_CLAIMED`
- a deadline greater than the bounty's `max_deadline` →
  `ERR_BOUNTY_WRONG_DEADLINE`

### bounty_done

```json
{ "id": 0, "account_id": null, "description": "Bounty complete" }
```

`account_id` may be null to mean the caller. when it is not null it
names the claim owner.

- while the claim is still active the caller must be that owner →
  `ERR_BOUNTY_DONE_MUST_BE_SELF`
- an already-completed claim → `ERR_BOUNTY_CLAIM_COMPLETED`

once the claim has expired, anyone may call it to free the claim slot
— no proposal is created and no bond is needed.

### bounty_giveup

```json
{ "id": 0 }
```

within the DAO's forgiveness period the bond is returned; after it,
the bond is forfeited. the period is measured from the claim's
`start_time`.

---

#### THE PERMISSION MODEL

a permission is written `<proposal kind>:<action>`. the prefix is the
kind of the **proposal**, not the method called.

the contract matches on four forms: `<kind>:<action>` (that action on
that kind of proposal), `<kind>:*` (every action on that kind), `*:<action>`
(that action on any kind), and `*:*` (everything).

the kind's label:

| kind | label |
| --- | --- |
| `ChangeConfig` | `config` |
| `ChangePolicy` | `policy` |
| `AddMemberToRole` | `add_member_to_role` |
| `RemoveMemberFromRole` | `remove_member_from_role` |
| `FunctionCall` | `call` |
| `UpgradeSelf` | `upgrade_self` |
| `UpgradeRemote` | `upgrade_remote` |
| `Transfer` | `transfer` |
| `SetStakingContract` | `set_vote_token` |
| `AddBounty` | `add_bounty` |
| `BountyDone` | `bounty_done` |
| `Vote` | `vote` |
| `FactoryInfoUpdate` | `factory_info_update` |
| `ChangePolicyAddOrUpdateRole` | `policy_add_or_update_role` |
| `ChangePolicyRemoveRole` | `policy_remove_role` |
| `ChangePolicyUpdateDefaultVotePolicy` | `policy_update_default_vote_policy` |
| `ChangePolicyUpdateParameters` | `policy_update_parameters` |

the action labels are the contract's own action enum: `AddProposal`,
`RemoveProposal`, `VoteApprove`, `VoteReject`, `VoteRemove`,
`Finalize`, `MoveToHub`.

so to add a `FunctionCall` proposal a role needs `call:AddProposal`,
and to approve one it needs `call:VoteApprove`.

---

#### THE VOTE COUNTING

a proposal's `vote_counts` is keyed by **role**, one entry per role
that voted, each a `[yes, no, spam]` triple.

a vote counts once for **each** of the voter's roles that permits the
action on that proposal's kind. so an account in two permitting roles
is counted twice, once under each role — the threshold is measured
against the roles, not the people.

the threshold for a role is its own `vote_policy` for that kind, and
the DAO's `default_vote_policy` when the role has none. a role's
threshold wins over the default.

the default threshold is a `[for, against]` pair — `[1, 2]` on
`onsocial.sputnik-dao.near`, so one vote for and two against reject. a
role's own threshold is a plain count, `"1"`.

a role of kind `Everyone` is skipped when the threshold is worked out:
it has no members to count, so it never carries a threshold of its own.
an account in such a role can still hold permissions and vote.

---

#### THE MEMBERS

there is **no** method that lists every member of a DAO. the policy
only holds role → member lists, and the roles that are open to
everyone name no accounts at all.

so the member list is the union of the roles' member lists, and an
account in three roles is **one** member, not three.

---

#### THE RAW-BYTE METHODS

three methods take their input as **raw bytes**, not JSON:

- the factory's `store` — the DAO contract WASM
- the DAO's `store_blob` — the blob
- the DAO's `update` — the new contract WASM

they do not appear in the contract's ABI, so `near contract inspect`
shows no argument shape for them.

the DAO's `update` is callable by the account itself, or by its
factory when the DAO's `auto_update` is on. when the factory triggers
it, the DAO first requires an `UpgradeSelf` proposal whose hash matches
the incoming code, and that proposal must be at least two weeks old —
otherwise a new `UpgradeSelf` proposal is created and nothing is
deployed.

---

#### THE PRIVATE CALLBACKS

these are called by the contract, not by a human:

| method | who calls it |
| --- | --- |
| `on_proposal_callback` | the DAO, after a proposal is approved |
| `on_create` | the factory, when it deploys a DAO |
| `migrate` | the contract itself, during an upgrade |
| `new` | the factory, to bring a DAO up |

`on_proposal_callback` asserts exactly one promise result and flips
the proposal to `Approved` or `Failed`.

---

#### THE SOURCE

the DAO contract is `sputnikdao2`, from
`near-daos/sputnik-dao-contract`. the factory is `sputnikdao-factory2`.

```sh
near contract inspect sputnik-dao.near network-config mainnet now
near contract inspect huggies.sputnik-dao.near network-config mainnet now
near contract inspect sputnikv2.testnet network-config testnet now
```

=====================
<br/>
copyright 2026 by sleet.near
