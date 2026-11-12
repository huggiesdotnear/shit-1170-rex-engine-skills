# MODES

propose against autonomous, and the exception autonomous makes.

---

#### THE RULE EVERY OTHER SKILL FOLLOWS

**the agent NEVER calls a contract.** every state-changing call goes
through the shit-1170 rex engine as a QUEUED generic function call,
and a human signs it in the web app with their wallet.

the agent prepares the transaction and queues it. it does not sign,
send, or wait for a signature.

**that rule is what makes an agent safe.** it is why a channel message
on irc cannot move money, and why a prompt in a room cannot make the
agent call anything. the human's signature is the last line of
defence, and the agent never asks for one.

---

#### PROPOSE MODE

the default, and it follows the rule exactly.

```sh
# build the payload
bun bin/chess_propose_move.ts --account kcameau.near --game-id '[206540279,"kcameau.near","crans.near"]'

# queue it, and a human signs it in the web app
bun ../shit-1170-rex-engine/bin/queue_tx.ts --file request.json
```

the payload is the exact shape the engine's tx-queue accepts:

```json
{
  "contractId": "app.chess-game.near",
  "method": "play_move",
  "args": { "game_id": [206540279, "kcameau.near", "crans.near"], "mv": "f7f6" },
  "gas": "150000000000000",
  "deposit": "0"
}
```

`gas` and `deposit` are **raw digit strings** — gas units and
yoctoNEAR. raw digits are preferred because there is no ambiguity
about what they mean.

**what it needs:** the engine's API key, the same one every other
skill in the library uses. it lives in the engine skill's keyring at
`${HOME}/.shit-1170-rex-engine/accounts/<account_id>.json`.

---

#### AUTONOMOUS MODE

**autonomous mode breaks the rule, on purpose, and only here.**

the agent signs its own calls with a **limited access key** — a NEAR
key that names one contract and the methods it may call there.

### WHY IT IS SAFE, AS FAR AS IT IS SAFE

the break is bounded by four things:

1. **the key is limited.** it names one receiver —
   `app.chess-game.near` — and it cannot sign for the account itself.
   so it cannot move the account's NEAR, cannot create accounts, and
   cannot add or delete keys.
2. **the human signs the key itself.** the `add_key` is queued like
   every other write, and a human approves it in the web app. a key
   that a human approves cannot be created by a compromised agent
   alone.
3. **the methods are checked before the key is used.** the skill
   refuses a key whose method list does not include `play_move`.
4. **the key is one contract wide.** it cannot touch the engine's
   queue, another account, or any other contract.

### WHAT IT STILL CANNOT DO

**a limited key cannot move the account's funds.** it cannot sign for
the account, so it cannot transfer NEAR out, and it cannot be used to
pay for anything.

### THE WHOLE-CONTRACT KEY, AND ITS SHARP EDGES

no method list means the key may call **every** method on
`app.chess-game.near`. that includes:

- the game methods — `play_move`, `resign`, `cancel`, `challenge`,
  `accept_challenge`, `reject_challenge`, `claim_points`,
  `set_is_agent`
- **`withdraw_token`** — pulls any token the contract holds for that
  account back out
- **`cancel_bet`** — on the betting surface
- the NEP-141 surface the contract implements itself — `ft_transfer`,
  `ft_transfer_call` — which move **PPP points**. those points are
  non-transferable by design and panic, so the path is dead.

so the realistic worst case is the agent pulling out tokens **it has
already wagered into the contract**. it is not zero, and it is not a
drain of the account.

**the narrower key is one flag away.** naming the method list and
omitting `withdraw_token` and `cancel_bet` keeps every game operation
and drops the money-shaped methods:

```sh
bun bin/key_queue_add.ts \
  --receiver-id app.chess-game.near \
  --methods play_move,resign,cancel,challenge,accept_challenge,reject_challenge,claim_points,set_is_agent,join_matchmaking,cancel_matchmaking,create_ai_game \
  --allowance 1000000000000000000000000
```

**the allowance is the PREPAID GAS, not the deposit.** the contract
takes `gas_limit x gas_price` from the key's allowance before the call
runs. mainnet's gas price is 1000000000 yoctoNEAR per gas unit, so the
largest call this skill makes — 400 Tgas, against a VeryHard ai —
needs 0.40 NEAR of allowance. an allowance of 0 is refused with
`NotEnoughAllowance` before the contract is reached at all.

**the method list is the whole skill.** `join_matchmaking` and
`cancel_matchmaking` are how the daemon finds a game, and
`create_ai_game` is how a game against the ai is opened. a key without
them cannot do those, and the contract refuses the call with
`MethodNameMismatch`.

**the key is queued, not signed**, so the choice stays open until a
human approves it. `chess_key_add.ts` shows both commands.

---

#### WHAT STAYS QUEUED, IN BOTH MODES

these are never autonomous:

- `storage_deposit` — the registration. it attaches 0.05 NEAR.
- `add_key` and `delete_key` — the key's own addition and removal.
- **anything with a token deposit**: `ft_transfer_call` for a bet, a
  wager, or a wagered challenge.
- anything on any other contract.

**bets and wagers are never autonomous.** a token deposit moves money,
and the human signs every one of those.

**a wagered CHALLENGE is never accepted by the daemon.** the daemon
skips it and says so in the log. accepting one means attaching a
token deposit.

---

#### THE TWO CREDENTIALS

| mode | credential | where it lives |
| --- | --- | --- |
| propose | the engine's **API key** | `${HOME}/.shit-1170-rex-engine/accounts/<account_id>.json` |
| autonomous | the NEAR **limited access key** | `${HOME}/.shit-1170-rex-engine/keys/keys.sqlite` |

**the chess skill reads the keys skill's sqlite directly**, with a
narrow query: the one key whose receiver is the chess contract. it
does NOT go through `key_list.ts`, because that listing is
deliberately secret-free — a listing is a thing an agent reads and
then repeats in a conversation, and a secret that is read is a secret
that is copied.

the private key is never printed by anything in this skill.

---

#### WHICH MODE FOR WHICH JOB

| the user wants | the mode |
| --- | --- |
| "what move should I play" | propose |
| "make that move" | propose, and the human signs it |
| "play a game against the ai" | propose — `create_ai_game` is one queue payload |
| "find me an opponent" | autonomous for the queue, or propose for the challenge |
| "play on its own" | autonomous, and the daemon |
| "bet on that game" | **propose only.** a token deposit moves money. |

---

#### THE THREE THINGS THAT ARE NOT PROMISES

the irc skill makes a point of the difference between a rule the agent
follows and a rule the TOOL enforces. the same applies here.

**the tool cannot sign for the account.** a limited key cannot move
the account's NEAR. that is the chain's rule, not the agent's
discipline.

**the agent cannot queue a transaction in autonomous mode.** the
autonomous bins sign and send; they never write to the engine's queue.
a wagered challenge is skipped rather than queued, so the daemon
cannot even ask the human to sign one by accident.

**the daemon cannot be reached.** it is a plain process with no http
api. nothing can talk to it while it plays.

the rest — the method list on the key, the choice to widen it, the
decision to run the daemon at all — is on the human and on the agent,
and that is the honest boundary.

=====================
<br/>
copyright 2026 by sleet.near
