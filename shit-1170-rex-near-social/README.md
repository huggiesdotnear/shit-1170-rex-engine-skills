# shit-1170-rex-near-social

near.social for the shit-1170 rex engine.

near.social is a public social network on NEAR: profiles, posts,
replies, quotes, likes, reposts and follows. every write is a NEAR
transaction to the account `social`, stored by FastData KV, and every
read comes from the indexer API at `https://api2.near.social`.

**the agent reads everything and publishes nothing.** a read goes to
the indexer API directly; a write is a QUEUE PAYLOAD that the engine
holds for a human to sign. the receipt of a social write fails by
design — the receiver has no contract, and the indexer reads the
transaction rather than the receipt. verify through the indexer.

- the skill: [SKILL.md](./SKILL.md)
- the engine skill, for the queueing mechanics:
  [shit-1170-rex-engine](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md)

## the bins

### the reads

```sh
# what is happening on near.social?
bun bin/feed.ts --feed global --limit 20

# the home feed, with what the viewer follows mixed in
bun bin/feed.ts --feed for_you --viewer alice.near

# a hashtag feed
bun bin/feed.ts --feed hashtag --tag near

# an account, and its posts
bun bin/account.ts alice.near --limit 10

# a post, with the thread above it and its replies
bun bin/post.ts alice.near/1759140000000 --replies

# search, notifications, suggestions, trending hashtags
bun bin/search.ts --search near
bun bin/search.ts --notifications alice.near
bun bin/search.ts --trending

# how far has the indexer got?
bun bin/search.ts --status
```

every list endpoint answers with `{ items, next_cursor }`. the cursor
is **opaque** — hand it back exactly as it came.

### the writes

```sh
# the queue payload for a post
bun bin/post_write.ts --account alice.near --text "gm #near"

# a reply, a quote, an edit
bun bin/post_write.ts --account alice.near --text "agreed" --reply-to bob.near/1759140000000 --root-is-parent
bun bin/post_write.ts --account alice.near --text "worth reading" --quote bob.near/1759140000000
bun bin/post_write.ts --account alice.near --text "edited" --post-id 1759140000000 --edit

# a like, a repost, a follow — and their undo
bun bin/edge.ts --account alice.near --like bob.near/1759140000000
bun bin/edge.ts --account alice.near --repost bob.near/1759140000000
bun bin/edge.ts --account alice.near --follow bob.near
bun bin/edge.ts --account alice.near --follow bob.near --undo

# a profile field, and clearing one
bun bin/profile.ts --account alice.near --field about --value "I summarize #near news."
bun bin/profile.ts --account alice.near --service website --value "https://alice.dev"
bun bin/profile.ts --account alice.near --field location --clear

# a deleted post
bun bin/delete.ts --account alice.near --post-id 1759140000000
```

**none of the write bins queues anything.** they print the payload;
the engine skill's `queue_tx.ts` queues it.

### after the human signs

```sh
# what did the indexer do with the transaction?
bun bin/tx.ts <tx_hash> --for 30
```

## the write is a `__fastdata_kv` call on `social`

the args object **is** the set of writes — each top-level key is one
KV key:

```json
{
  "post/1759140000000": { "text": "gm #near" },
  "reply/bob.near/1759140000000/1759140000500": {}
}
```

| what | key | value |
| --- | --- | --- |
| a post | `post/{post_id}` | `{ text, media, reply_to, root, quote }` |
| a reply's backlink | `reply/{parent}/{post_id}` | `{}` |
| a like | `like/{post_author}/{post_id}` | `{}` / `null` |
| a repost | `repost/{post_author}/{post_id}` | `{}` / `null` |
| a follow | `graph/follow/{followed_account}` | `{}` / `null` |
| a profile field | `profile/{field}` | a string / `null` |
| a profile link | `profile/links/{service}` | a string / `null` |

**the key names the TARGET, not the account that signs the write.** a
like's key carries the **post's author** — the liker is the
predecessor of the receipt, and it is not in the key. a follow's key
carries the account that is followed.

the gas is **`1`** and the deposit is **`0`** — the call does no work,
so the gas is only there to satisfy the chain's minimum.

## the check is the point

the FastData indexer **drops what breaks its rules SILENTLY**. no
error, no failed receipt, nothing. the post just never appears.

so every write bin checks its payload against the standard first, and
**refuses** one that breaks a rule — exit code 2, with the rules it
breaks named:

```sh
bun bin/post_write.ts --account alice.near --text "   "
```

```text
{"ok":false,"error":"the payload breaks 1 rule(s) of the social-kv/1 standard, and the indexer DROPS what breaks them silently:
  - post_empty: \"post/1794374776323\" has no text, no media and no quote, so the post is invalid and therefore absent"}
```

the checks cover the key and value byte limits, the 256-key limit, the
post's validity, the text lengths, the media's mime and dimensions,
and the account ids and post ids the standard accepts.

## a delete is a tombstone

writing `null` removes the post — but **the old versions stay in
public history forever**, and anyone can read them. FastData keeps
the full history of every key. say so before queueing a delete.

## the sources

the facts come from the primary sources, not from a summary of them:

- [near.social/standard.md](https://near.social/standard.md) — the
  write standard: the keys, the values, the limits, the gas `1`, the
  failed receipt, the tombstone rule
- [api2.near.social/api.md](https://api2.near.social/api.md) — the
  read api
- [near.social/skill.md](https://near.social/skill.md) — the agent
  guide
- `@sleet-js/middleman-near-social-api` — the typed client the reads
  go through

=====================
<br/>
copyright 2026 by sleet.near
