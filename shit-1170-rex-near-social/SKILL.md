---
name: shit-1170-rex-near-social
description: "Read near.social and prepare posts, replies, quotes, likes, reposts, follows and profile edits for a human to sign with the shit-1170 rex engine. Use this skill whenever the user mentions near.social, near social, a social post, posting on near, a tweet, a reply, a quote, a like, a repost, a follow, a hashtag feed, the global feed, a home feed, notifications, a social profile, or reading someone's near.social posts — and also when the user wants to check whether a near.social write actually landed. The reads go through the near.social indexer API; the writes are social-kv/1 FastData KV transactions to the `social` account, queued for a human to sign. Emit a queue payload for a human to sign; never send it yourself."
---

# shit-1170 rex near.social

near.social is a public social network on NEAR: profiles, posts,
replies, quotes, likes, reposts and follows. every write is a NEAR
transaction to the account `social`, stored by FastData KV, and
every read comes from the indexer API at `https://api2.near.social`.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture:
<https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>.
this skill holds the near.social-specific parts.

**the rules that apply here too:** the agent never calls a contract —
a read goes to the indexer API, a write emits a QUEUE PAYLOAD for a
human to sign. the engine skill states the rule in full:
<https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>.

---

#### THE SPLIT

| side | what it is | who does it |
| --- | --- | --- |
| **read** | the indexer API at `https://api2.near.social` | the agent, directly. no API key, no engine account, no wallet |
| **write** | a `__fastdata_kv` transaction to `social` | the agent PREPARES it, the engine QUEUES it, a HUMAN SIGNS it |

the reads go through `@sleet-js/middleman-near-social-api` — the typed
client for that API, one function per endpoint and one type per
response shape. the writes are the `social-kv/1` standard, and the
queue payload they become is `{ contractId, method, args, gas,
deposit }`.

**the API is mainnet-only.** there is no testnet variant, so the read
bins have no `--network` flag. near.social is mainnet.

---

#### THE RECEIPT FAILS, AND THAT IS CORRECT

**read this before you queue anything.**

a social write's receipt **fails**, with

```
CompilationError(CodeDoesNotExist { account_id: "social" })
```

**that is the expected shape of a social write, not a broken one.**

`social` has no contract on it, and none is needed — so the call
cannot succeed, and the receipt fails. the FastData indexer does not
look at receipt status. it reads the **transaction** and indexes the
args out of the action.

so: **a human who signs a social post will see a failed receipt.** do
not read that as a broken post, and do not tell the human their post
failed. verify through the **indexer** instead:

```sh
bun bin/tx.ts <tx_hash> --for 30
```

`indexed: false` means the indexer has not seen it yet — poll again
in a second or two. **never resend because of the failed receipt.**

---

#### THE WRITE

| field | value |
| --- | --- |
| receiver | **`social`** |
| method | `__fastdata_kv` |
| args | a JSON **object**. each top-level key is one KV write |
| gas | **`1`** |
| deposit | **`0`** |

**the gas is `1`.** the call does no work, so the gas is only there
to satisfy the chain's minimum. a function-call access key is
charged for the gas it attaches, and 30 Tgas on a write that does
nothing costs real NEAR for no reason.

### --- THE ARGS ARE THE WRITES ---

there is no `args` field with the post inside it. **the args object
IS the set of writes.** each top-level key is one KV key:

```json
{ "post/1759140000000": { "text": "gm #near" } }
```

a reply writes TWO keys in one action — the post and its backlink:

```json
{
  "post/1759140000500": { "text": "Agreed!", "reply_to": "bob.near/1759140000000", "root": "bob.near/1759140000000" },
  "reply/bob.near/1759140000000/1759140000500": {}
}
```

### --- THE KEYS ---

| what | key | value |
| --- | --- | --- |
| a post | `post/{post_id}` | `{ text, media, reply_to, root, quote }` |
| a reply's backlink | `reply/{parent}/{post_id}` | `{}` |
| a like | `like/{post_author}/{post_id}` | `{}` / `null` |
| a repost | `repost/{post_author}/{post_id}` | `{}` / `null` |
| a follow | `graph/follow/{followed_account}` | `{}` / `null` |
| a profile field | `profile/{field}` | a string / `null` |
| a profile link | `profile/links/{service}` | a string / `null` |

**an edge is ACTIVE if and only if its value is a JSON object.** `{}`
turns it on and `null` turns it off.

### --- THE ACCOUNT IN A LIKE OR REPOST KEY ---

**the key names the TARGET POST, not the account that likes it.**

so `like/{post_author}/{post_id}` — the author of the post being
liked. the account that SIGNS the write is the liker, and it is not
in the key. it is the predecessor of the receipt.

this is the one thing about the edge keys that is easy to get wrong,
so here is the chain saying it out loud. on mainnet, `yawrd.near` and
`vandal.near` both wrote

```
like/23387b92c198449578298eb95af966d14dc4d0c0e6ef056315d6f6245f7ac7be/1793547766638
```

for the same post — and that account is the post's AUTHOR, not
either of the likers. `GET
/v1/posts/23387b92.../1793547766638/likes` answers with
`vandal.near` and `yawrd.near`, the two accounts that signed those
writes.

a follow is the other way round: `graph/follow/{account}` names the
account that is FOLLOWED, because that is the target of the edge.

**a post id is the current Unix time in milliseconds**, which is what
the standard says clients SHOULD use. it must be a decimal integer
with no leading zeros, up to 2^53 − 1.

### --- THE RULES OF A REPLY ---

**`root` is the top of the thread.** the standard: `root` MUST equal
the parent's `root`, or the parent itself when the parent is a
top-level post.

so the root **cannot be guessed from the parent alone** — when the
parent is itself a reply, the root is the top of the thread and the
parent is not it. writing the parent as the root would put the reply
in the wrong place, and the standard's MUST is a MUST.

so the skill writes the root only when it is known:

| the case | what to pass |
| --- | --- |
| the parent is a **top-level** post | `--root-is-parent` |
| the parent is **itself a reply** | `--root <account_id/post_id>`, the top of the thread |
| you do not know | nothing — the root is left out |

**with no root at all, the indexer falls back to `reply_to`.** so an
omitted root is a safe answer, and a WRONG root is not. the bin says
which case it is in its `root` field.

the reply's `reply_to` names the parent, and `root` names the top of
the thread. getting `root` wrong puts the reply in the wrong place.

### --- A POST WITH NO TEXT IS NOT A POST ---

a post is valid when it has **non-empty trimmed text, at least one
media item, or a quote**. a post with none of the three is INVALID,
and an invalid post is **ABSENT** — it does not show up at all, with
no error anywhere.

---

#### THE LIMITS

the FastData indexer enforces these, and **what fails them is DROPPED
SILENTLY**. no error, no failed receipt, nothing. the post just never
appears.

so every limit is checked **before** the payload is queued, and a
payload that breaks one is **refused** with exit code 2.

| rule | limit |
| --- | --- |
| keys per call | at most **256**. over it, the WHOLE action is dropped |
| key length | at most **1024 bytes**. over it, that key is dropped |
| value length | at most **256 KiB**. over it, that key is dropped |
| the whole transaction | at most **1.5 MiB**. over it, the chain rejects it |
| post text | at most **25,000 characters** |
| profile `about` | at most **10,000 characters** |
| profile `name`, `location` | at most **256 characters** |
| a profile link | at most **2,048 characters**, and at most **32 links** |
| media per post | at most **10** |
| media `w`, `h` | integers in **1..16384** pixels |
| media `alt` | at most **5,000 characters** |

and the **per account, per UTC day** limits the indexer applies:

| what | the limit |
| --- | --- |
| posts | 300 |
| likes | 1000 |
| reposts | 300 |
| follows | 5000 |
| data | 5 MiB |

a write over a daily limit is **recorded but NOT applied**, and the
indexer reports it as `rate_limited`.

---

#### THE MEDIA

a post's media is a `fastfs://` URI, and **v1 accepts no other
scheme** — an `https://` image makes the whole post invalid, and
therefore absent.

```
fastfs://{uploader_account}/{receiver}/{path}
```

the mime must be one of `image/webp`, `image/jpeg`, `image/png`,
`image/gif`, `image/avif`.

**the upload itself is a different skill.** the
[shit-1170-rex-fastfs](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-fastfs/SKILL.md)
skill has the borsh payload, the 1 MiB chunking rule and the limits.
upload first, get the `fastfs://` URI, then put it in the post.

---

#### THE ETIQUETTE

**say you are automated.** the agent guide asks for it, and so does
good manners: put it in the profile's `about` field, and add a
`website` link.

```sh
bun bin/profile.ts --account alice.near --field about --value "I summarize #near news. Automated account."
bun bin/profile.ts --account alice.near --service website --value "https://alice.dev"
```

**never put secrets in a post or a profile.** everything there is
public and permanent.

**deletes are tombstones.** writing `null` removes the post, but the
old versions stay in public history forever and anyone can read them.
say so before queueing a delete.

**don't spam mentions, replies or follows.** accounts that spam can
be hidden by the operator.

---

#### THE FLOW

1. **read first** — the read bins. what does the account look like,
   what is the post that is being replied to, does it exist?
2. **prepare** — the write bins. they print the QUEUE PAYLOAD and
   check it against the standard. a payload that breaks a rule is
   refused with exit code 2.
3. **explain it** — say what the write does in plain language,
   before it is queued.
4. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`. see the engine skill for the queueing mechanics.
5. **the human signs it.**
6. **read it back** — `bin/tx.ts --tx-hash <hash> --for 30`. the
   indexer is the answer, not the receipt.

### --- WHERE THE HASH COMES FROM ---

**the human does not paste a hash into the chat.** the engine holds
the hash of every send, so the agent reads it back out of the queue
it queued:

```sh
bun ../shit-1170-rex-engine/bin/queue_sent.ts tx --queue <queue_id> --from-server
```

then the indexer answers what became of it:

```sh
bun bin/tx.ts <tx_hash> --for 30
```

### --- THE KEY STATUSES ---

| status | what it means |
| --- | --- |
| `ok` | accepted |
| `invalid` | the value broke the standard, and the key says why. the entity is now **absent** |
| `ignored` | an unknown key, **or a known key the indexer does not use, such as `reply/…`** |
| `rate_limited` | over the daily limits, and not applied |
| `key_too_long` | the key was dropped |
| `value_too_large` | the value was dropped |

**`ignored` on a `reply/…` key is NORMAL.** the reply's backlink is
a key the standard tells clients to write, and the reference indexer
ignores it — it derives threads from the post's `reply_to` instead.
so a reply's payload answers with one `ok` (the post) and one
`ignored` (the backlink), and that is a good result. an agent that
reads `ignored` as a failure would refuse a reply that worked.

the action's own `status` is separate from the key's. it is `ok`,
`invalid_json` (the args were not a JSON object), `too_many_keys`
(over 256 — **nothing was applied**) or `invalid_borsh` (a FastFS
payload that could not be decoded).

---

#### THE BINS

all bins live in `bin/`, are run with `bun`, print JSON on stdout,
and print JSON errors on stderr with a non-zero exit code. **a
refusal — a payload that breaks the standard — exits 2.**

### the read bins

| bin | what it does |
| --- | --- |
| `feed.ts` | the four feeds: `for_you`, `global`, `following`, `hashtag` |
| `account.ts` | an account's profile, and its posts or its replies |
| `post.ts` | a post with its ancestors, and its replies, quotes, likes, reposts, preview |
| `search.ts` | search, notifications, suggestions, trending hashtags, and the indexer's status |
| `tx.ts` | what the indexer did with a transaction — the answer after a human signs |

### the write bins

| bin | what it does |
| --- | --- |
| `post_write.ts` | prepare a post, a reply, a quote, or an edit |
| `edge.ts` | prepare a like, a repost or a follow — and their undo |
| `profile.ts` | prepare a profile field or a link, and clear one |
| `delete.ts` | prepare a deleted post |

---

#### THE READ BINS

every list endpoint answers with `{ items, next_cursor }`. the cursor
is **OPAQUE** — hand it back exactly as it came. `--limit` is 1..100.

**`--viewer`** answers "as this account": it adds the `liked`,
`reposted` and `following` flags to every item.

### `feed.ts`

```sh
bun bin/feed.ts --feed global --limit 20
bun bin/feed.ts --feed for_you --viewer alice.near
bun bin/feed.ts --feed following --account alice.near
bun bin/feed.ts --feed hashtag --tag near
```

the four feeds are `for_you` (trending, mixed with who the viewer
follows), `global` (every top-level post), `following` (the account's
own home feed) and `hashtag`.

### `account.ts`

```sh
bun bin/account.ts alice.near
bun bin/account.ts alice.near --profile
bun bin/account.ts alice.near --posts --limit 10
bun bin/account.ts alice.near --with-replies
```

**an account that has never posted answers with an empty profile and
`hasProfile: false`.** that is not an error — the profile comes back,
it just has nothing in it.

### `post.ts`

a post is named by its author and its id:

```sh
bun bin/post.ts alice.near/1759140000000
bun bin/post.ts alice.near/1759140000000 --replies --likes
bun bin/post.ts --batch alice.near/1759140000000,bob.near/1759140000001
```

the answer carries the post AND the chain of ancestors it replies to,
so a reply arrives with the conversation above it.

**`parentMissing: true`** means the post it replies to is gone — it
was deleted, or the indexer never saw it. the reply itself is fine.

### `search.ts`

```sh
bun bin/search.ts --search near
bun bin/search.ts --accounts mob --limit 10
bun bin/search.ts --notifications alice.near
bun bin/search.ts --count alice.near
bun bin/search.ts --suggestions
bun bin/search.ts --trending
bun bin/search.ts --status
```

**`--status` is worth reading first.** it says how far the indexer has
got on the chain, and how many accounts, posts, likes and follows it
has seen. `lagMs` is how far behind the chain it is.

---

#### THE WRITE BINS

every write bin prints the QUEUE PAYLOAD and **checks it against the
standard**. a payload that breaks a rule is refused with exit code
2 and the rules it breaks are named.

**none of them queues anything.** they print the payload; the engine
skill's `queue_tx.ts` queues it.

### `post_write.ts`

```sh
bun bin/post_write.ts --account alice.near --text "gm #near"
bun bin/post_write.ts --account alice.near --text "agreed" --reply-to bob.near/1759140000000 --root-is-parent
bun bin/post_write.ts --account alice.near --text "agreed" --reply-to bob.near/1759140000001 --root bob.near/1759140000000
bun bin/post_write.ts --account alice.near --text "worth reading" --quote bob.near/1759140000000
bun bin/post_write.ts --account alice.near --text "look" --media '[{"src":"fastfs://alice.near/social/media/abc.webp","mime":"image/webp","w":1200,"h":800}]'
bun bin/post_write.ts --account alice.near --text "edited" --post-id 1759140000000 --edit
```

**an edit is writing the same `post/{id}` again** with the full new
value. `--edit --post-id <id>` does that.

### `edge.ts`

```sh
bun bin/edge.ts --account alice.near --like bob.near/1759140000000
bun bin/edge.ts --account alice.near --repost bob.near/1759140000000
bun bin/edge.ts --account alice.near --follow bob.near
bun bin/edge.ts --account alice.near --like bob.near/1759140000000 --undo
```

`--undo` writes `null` instead of `{}`, which turns the edge off.

**following yourself is ignored** by the indexer, so the bin refuses
it rather than queueing a write that does nothing.

### `profile.ts`

```sh
bun bin/profile.ts --account alice.near --field name --value "Alice"
bun bin/profile.ts --account alice.near --field about --value "I summarize #near news."
bun bin/profile.ts --account alice.near --service website --value "https://alice.dev"
bun bin/profile.ts --account alice.near --field location --clear
bun bin/profile.ts --fields
```

`--clear` writes `null`, which **clears** the field. it is a
tombstone, not a private erase.

### `delete.ts`

```sh
bun bin/delete.ts --account alice.near --post-id 1759140000000
bun bin/delete.ts --account alice.near --post-id 1759140000000 --reply-to bob.near/1759140000000
```

a reply's delete also tombstones its backlink, or the reply stays
discoverable through the public KV API.

---

#### EXAMPLES

read the global feed and find something to reply to:

```sh
bun bin/feed.ts --feed global --limit 10
bun bin/post.ts oxmnt.tg/1794350042236
```

prepare a reply to it:

```sh
bun bin/post_write.ts --account alice.near --text "nice one" --reply-to oxmnt.tg/1794350042236
```

the queue payload looks like this:

```json
{
  "contractId": "social",
  "method": "__fastdata_kv",
  "args": {
    "post/1794374795302": {
      "text": "nice one",
      "reply_to": "oxmnt.tg/1794350042236",
      "root": "oxmnt.tg/1794350042236"
    },
    "reply/oxmnt.tg/1794350042236/1794374795302": {}
  },
  "gas": "1",
  "deposit": "0"
}
```

then queue it with the engine skill:

```sh
bun ../shit-1170-rex-engine/bin/queue_tx.ts --file request.json
```

and after the human signs:

```sh
bun ../shit-1170-rex-engine/bin/queue_sent.ts tx --queue <queue_id> --from-server
bun bin/tx.ts <tx_hash> --for 30
```

---

#### WHEN NOT TO USE THIS SKILL

- **a FastFS file upload** — that is the
  [fastfs](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-fastfs/SKILL.md)
  skill. this skill references its `fastfs://` URI; it does not
  upload.
- **the raw KV, without the indexer** — the public FastData KV API
  at `https://kv.main.fastnear.com` serves the raw data. this skill
  reads through the indexer, which is easier.
- **the legacy socialdb profiles** — the old near.social stored
  profiles on `socialdb.near`. the indexer carries them under
  `/v1/legacy/`, but the legacy format is not the `social-kv/1`
  standard this skill writes.
- **a contract the engine owns** — use that contract's own skill.

---

#### MORE

- the standard, which is the source of every write fact:
  <https://near.social/standard.md>
- the api: <https://api2.near.social/api.md>
- the agent guide: <https://near.social/skill.md>
- the typed client: `@sleet-js/middleman-near-social-api`
- the engine skill for the queueing mechanics:
  <https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md>

=====================
<br/>
copyright 2026 by sleet.near
