---
name: shit-1170-rex-fastfs
description: Prepare FastFS file uploads with the shit-1170 rex engine — the __fastdata_fastfs method, the borsh payload format, the 1 MiB chunking rule, the 32 MiB file limit, the serving URL on fastfs.io, and the queue payloads for a human to sign. Use this skill whenever the user mentions FastFS, fastfs.io, fastdata, __fastdata_fastfs, uploading a file to the chain, storing a file on NEAR, a file's fastfs:// URI, serving a file from an account's namespace, or a media upload that needs borsh-encoded bytes. Also use it when a FastFS receipt failed with CodeDoesNotExist, when an uploaded file never appears at its fastfs.io URL, or when a FastFS action's args turned out to be JSON instead of borsh. Emit a queue payload for a human to sign; never send it yourself.
---

# shit-1170 rex FastFS

FastFS is FastData's file standard. a file is uploaded by a NEAR
transaction whose bytes the FastData indexer picks up and serves
over http.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture. this skill holds the FastFS-specific
parts.

**the rules that apply here too:** the agent never calls a contract. a
read goes to the near-kit tool box (`@near-kit-tool-box/fun`); a write
emits a QUEUE PAYLOAD for the engine to queue for a human to sign.
never `near.call`, never `generic_contract_call_fun`, never
`generic_contract_call_wallet`.

---

#### THE RECEIPT FAILS, AND THAT IS CORRECT

**read this before you queue anything.**

a FastFS upload's receipt **fails**, with

```
CompilationError(CodeDoesNotExist { account_id: "fastfs.near" })
```

**that is the expected shape of a FastFS upload, not a broken one.**

the receiver has no contract on it, and none is needed — so the call
cannot succeed, and the receipt fails. the FastData indexer does not
look at receipt status. it reads the **transaction** and indexes the
bytes out of the action's args.

the real mainnet upload,
`5vUqtNhYchWyrifviVZ9F6k4QprgfW9fjSAtcGMdQyRw`, has exactly that
failed receipt — and the file is served today at
<https://mob.near.fastfs.io/fastfs.near/fastnear.png>.

so: **a human who signs a FastFS upload will see a failed receipt.**
do not read that as a broken upload, and do not tell the human their
upload failed. verify through the **serving URL** instead.

---

#### THE WRITE

| field | value |
| --- | --- |
| method | `__fastdata_fastfs` |
| receiver | **any account.** `fastfs.near` is the convention and the namespace everyone uses. there is no contract on it, and it does not need code |
| args | **raw borsh bytes.** not a JSON object |
| gas | `1` |
| deposit | `0` |

**the gas is `1`.** the call does no work, so the gas is only there to
satisfy the chain's minimum. the HackMD doc's "300 Tgas" is not what
the reference client sends, and the real mainnet transaction used gas
`1`.

### --- THE ARGS ARE RAW BYTES, NOT BASE64 ---

**the HackMD doc says "base64". that is the JSON-RPC *presentation* of
the bytes, not the wire format.**

the indexer does this:

```rust
if let Ok(value) = borsh::from_slice(&fastdata.data) {
```

on the **raw bytes** of the action's args. `borsh::from_slice` does not
decode base64 — it reads borsh straight from the first byte. base64-
encoding the payload and sending that would decode to the base64
*text*, which is not borsh, and the indexer would **drop the action
silently**.

JSON cannot carry raw bytes, so the queue payload carries them
base64-encoded in `argsBase64` — that is the JSON envelope, not the
wire format. the engine decodes `argsBase64` back to raw bytes before
it becomes the action's args, and that is what the indexer reads.

### --- THE BYTES MUST CROSS EVERY BOUNDARY AS BYTES ---

**this is the one thing that breaks a FastFS upload, and it breaks it
silently.**

the bytes have to reach the chain as bytes. if they pass through
`JSON.stringify` — or are turned into a plain object on the way — the
action's args become the **json text** of a byte map:

```
{"0":0,"1":15,"10":47,"11":115,…}
```

that is not borsh. the indexer does `borsh::from_slice` on the raw
args, gets nothing, and **drops the action**. there is no error: the
receipt fails the way a FastFS receipt always fails, the file never
appears at its URL, and the CDN caches the 404.

**and the wallet decides how the bytes cross.** the wallets split in
two, and the second kind cannot do it at all:

| the wallet | what it wants |
| --- | --- |
| the **browser-signer** wallets — MyNearWallet, OKX, Nightly, HOT Wallet | the bytes, as a `Uint8Array` |
| the **wallet-server** wallets — the Intear Wallet is one | **nothing works** |

a wallet-server wallet cannot carry raw bytes. it reads the
transaction out of json and writes the arguments back out with
`serde_json::to_vec`, and **every json value serializes to text** — a
`Uint8Array` becomes the json text of a byte map, and a base64 string
becomes the json text of a string. neither is the file's bytes. its
native action *could* carry them, but its action enum is
`#[serde(untagged)]` and `serde_as` does not work through an untagged
enum, so the native variant never matches and the fallback always does.

**so a FastFS upload only works through a browser-signer wallet.** the
app asks the connected wallet which one it is and refuses the call
outright when the wallet cannot carry the bytes — a refused call tells
the reader, and a dropped call tells them nothing.

**how to tell, from the chain, which of the two happened.** decode
the action's `args` from base64 and look at the first bytes.

| the first bytes of the action's args | what it means |
| --- | --- |
| `00 0f 00 00 00 …` | borsh — the variant byte, then a u32 length. correct |
| `7b 22 30 22 3a …` — the text `{"0":` | json — the bytes were stringified. broken |
| `22 41 41 38 …` — the text `"AA8` | a base64 string, quoted — the bytes were never decoded. broken |

the json one is longer than the borsh it replaced, because every byte
became a key, a colon and a number. a 52-byte borsh payload arrives
as 425 bytes of json.

**and the json text says which wallet did it.** the keys come out in
**lexicographic** order — `0,1,10,11,…,2,20,…` — because
`serde_json`'s map is a `BTreeMap`. javascript's `JSON.stringify`
orders integer-like keys *numerically*, so a lexicographic order means
a **Rust** side produced it, and that points at the wallet-server kind.

### the borsh schema

```rust
enum FastfsData {
    Simple(Box<SimpleFastfs>),   // variant index 0
    Partial(Box<PartialFastfs>), // variant index 1
}

struct SimpleFastfs {
    relative_path: String,
    content: Option<FastfsFileContent>,
}

struct FastfsFileContent {
    mime_type: String,
    content: Vec<u8>,
}

struct PartialFastfs {
    relative_path: String,
    offset: u32,          // a multiple of 1 MiB, and < 32 MiB
    full_size: u32,       // the whole file's size, 1..=33554432
    mime_type: String,
    content_chunk: Vec<u8>, // <= 1 MiB; a shorter chunk inside the file is read as zero-padded
    nonce: u32,           // 1..=2147483647; the SAME in every chunk of one upload
}
```

borsh's rules, which is all an encoder needs:

- the enum's variant index is **one byte** — `0` for Simple, `1` for
  Partial — written before the variant's fields.
- a `String` is a **u32 length prefix** (little-endian) then the UTF-8
  bytes.
- a `Vec<u8>` is a **u32 length prefix** then the bytes.
- an `Option<T>` is **one byte** — `0` for None, `1` for Some — then
  the value when it is Some.
- every integer is **little-endian**.

the reference frontend writes the same shape with camelCase field
names, which borsh maps onto the rust snake_case in order:

```js
const FastfsFileContent = { struct: { mimeType: "string", content: { array: { type: "u8" } } } };
const SimpleFastfs = { struct: { relativePath: "string", content: { option: FastfsFileContent } } };
const PartialFastfs = { struct: { relativePath: "string", offset: "u32", fullSize: "u32",
  mimeType: "string", contentChunk: { array: { type: "u8" } }, nonce: "u32" } };
const FastfsData = { enum: [ { struct: { simple: SimpleFastfs } }, { struct: { partial: PartialFastfs } } ] };
```

this skill's `src/fastfs.ts` hand-rolls the encoding rather than
taking a borsh dependency: the schema is small, fixed, and fully
known, and a hand-rolled encoder is auditable line by line. it also
has a **decoder**, so encode-then-decode round-trips — and the
round-trip is checked against the real mainnet transaction.

### the delete

a `Simple` payload with **no content** — `content: None` — deletes the
file at that path. there is no other way to remove one.

---

#### THE LIMITS

the indexer enforces these, and **what fails them is DROPPED
SILENTLY**. no error, no failed receipt, nothing. the file just never
appears at its URL, and the CDN then caches that 404.

so every limit is checked **before** the payload is queued.

| rule | limit |
| --- | --- |
| the relative path | at most **1024 characters** |
| the mime type | non-empty, at most **256 characters** |
| the chunk | at most **1 MiB** (1048576 bytes) |
| the offset | a multiple of 1 MiB, and less than 32 MiB |
| the whole file | **1..=33554432 bytes** (32 MiB). a bigger file is refused |
| the nonce | **1..=2147483647**, and the same in every chunk of one upload |

a `Simple` payload is not checked for a mime type when it has no
content — the delete case carries no mime and is never refused for
one.

---

#### THE CHUNKING RULE

- a file of **1 MiB or less** is **one `Simple` payload** — one
  transaction, one signature, the cheapest path.
- a bigger file is split into **1 MiB chunks, one `Partial` transaction
  each**. every chunk carries the **same `full_size`** and the **same
  `nonce`**. the `offset` is 0, 1 MiB, 2 MiB, … the last chunk is
  shorter.
- chunks may be sent in **any order**. the file is served only after
  **every** chunk is indexed.
- a file over **32 MiB** is refused by the indexer.

**the nonce is what holds the chunks together.** every chunk of one
upload carries the same nonce, and a **fresh** nonce is what makes a
re-upload of the same path a different file — with the old nonce, the
server mixes the old chunks in with the new ones. the reference
client's approach is the timestamp in milliseconds modulo 2^31, which
lands inside the indexer's `1..=i32::MAX` range. it does not need to
be secret; it only has to differ from the previous upload of the same
path.

---

#### THE SERVING URL

```
https://{predecessor_id}.fastfs.io/{receiver_id}/{relative_path}
```

**`predecessor_id` is the account that SIGNED the transaction** — the
receipt's predecessor — **not the receiver.** the real mainnet upload
was signed by `mob.near` to `fastfs.near`, so the file is at

```
https://mob.near.fastfs.io/fastfs.near/fastnear.png
```

the gateway-independent URI form is:

```
fastfs://{predecessor_id}/{receiver_id}/{relative_path}
```

### --- THE CDN CACHES 404s ---

**never poll the clean URL before the file exists.**

a request for a file that is not there yet comes back 404, and
Cloudflare **stores that answer and serves it again from its cache**.
so a poll of the clean URL can keep seeing a 404 for a file that was
indexed a minute ago — the CDN is answering from its own memory of a
miss.

so every poll carries a **`?v={random}`** query. it makes the URL
unique, so the CDN asks the origin instead of answering from the
cache, and the 404 that comes back is a fresh one.

### the indexer's lag

the file is served only after the indexer has processed the **final**
block, and then about **2–3 more seconds**. a 404 right after signing
is the indexer being slow, not the upload being broken.

---

#### THE FLOW

1. **check the file** — `bin/fastfs_check.ts`. the size, the mime,
   whether it fits in one call, and every limit it breaks. this is
   the step that saves a bad upload, because the indexer drops what
   fails its rules **silently**.
2. **build the payload** — `bin/fastfs_upload.ts`. it reads the file,
   decides `Simple` or `Partial` from the size, and prints the queue
   payload: one transaction for a small file, a **batch** of one
   transaction per chunk for a big one.
3. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`. see the engine skill for the queueing mechanics.
4. **explain it** — the file, the path, the mime, the number of
   transactions, the gas, the deposit, the queue id, the link to sign
   it — and say plainly that **the receipt will fail and that is
   expected**.
5. **the human signs it.**
6. **poll the URL** — `bin/fastfs_status.ts`, with the cache-busting
   query. **the URL is the answer, not the receipt.**

### --- THE URL STAYS A 404 ---

**a file that never appears at its URL is not a slow indexer.** run
`bin/fastfs_args.ts --tx <tx_hash>` and read the answer.

- `borsh` — the bytes reached the chain intact. the problem is
  elsewhere: the chunk is missing, the nonce is wrong, or the indexer
  is behind.
- `jsonified` — the bytes were stringified on the way to the wallet.
  **the file was never indexed and never will be.** re-send it with the
  bytes going through as bytes.

the jsonified case is the one that looks like a success. the receipt
fails the way a FastFS receipt always fails, so nothing is red, and
the CDN caches the 404 for good.

---

#### THE BINS

| bin | what it does |
| --- | --- |
| `fastfs_upload.ts` | prepare the queue payload for a file — one transaction, or a batch of one per 1 MiB chunk |
| `fastfs_check.ts` | inspect a file: the size, the mime, whether it fits one call, how many chunks, and every limit it breaks |
| `fastfs_url.ts` | the serving URL and the `fastfs://` URI, for a predecessor, a receiver and a path |
| `fastfs_status.ts` | poll the serving URL with a cache-busting query, and report when it returns 200 |
| `fastfs_args.ts` | read a transaction's action args off the chain and say whether they are borsh or stringified json |

all of them print JSON on stdout and JSON errors on stderr with a
non-zero exit code. a refusal — a file that breaks an indexer limit —
exits 2.

`fastfs_upload.ts` takes `--file <path>`, and optionally
`--relative-path <path>` (the path inside the namespace; it defaults
to the file's base name), `--receiver <account_id>` (it defaults to
`fastfs.near`), `--mime <type>` (it defaults to a guess from the
file's extension, over a small built-in table — pass `--mime` to state
it yourself), and `--gas` and `--deposit` (raw digit strings, which
override the defaults of `1` and `0`).

`fastfs_check.ts` takes `--file <path>`, and optionally
`--relative-path`, `--mime`, and `--receiver`.

`fastfs_url.ts` takes `--predecessor <account_id>` and
`--relative-path <path>`, and optionally `--receiver`.

`fastfs_status.ts` takes `--url <url>`, or the three of
`--predecessor`, `--receiver` and `--relative-path`, plus `--for
<seconds>` (the deadline, bounded) and `--interval <ms>`.

---

#### EXAMPLES

check a file before uploading it:

```sh
bun bin/fastfs_check.ts --file ./picture.png
```

prepare the upload:

```sh
bun bin/fastfs_upload.ts --file ./picture.png
```

a file that needs chunks:

```sh
bun bin/fastfs_upload.ts --file ./movie.mp4 --mime video/mp4
```

the serving URL, and the poll for it:

```sh
bun bin/fastfs_url.ts --predecessor alice.near --relative-path picture.png
bun bin/fastfs_status.ts --predecessor alice.near --relative-path picture.png --for 120
```

**a file that never appears at its URL** — ask the chain what the
action's args actually were:

```sh
bun bin/fastfs_args.ts --tx <tx_hash>
```

it says `borsh` or `jsonified`, and it names the fix. a `jsonified`
answer means the bytes were stringified on the way to the wallet.

the queue payload for a human to sign looks like this:

```json
{
  "contractId": "fastfs.near",
  "method": "__fastdata_fastfs",
  "argsBase64": "AAwAAABmYXN0bmVhci5wbmcBCQAAAGltYWdlL3BuZ4XaAQCJUE5HDQ...",
  "gas": "1",
  "deposit": "0"
}
```

**`argsBase64`, not `args`.** a FastFS call has no argument object —
its args are raw bytes, and the engine carries them as base64 in a
sibling field. exactly one of `args` and `argsBase64` is set.

---

#### WHEN NOT TO USE THIS SKILL

- a key-value write — that is FastData KV, `__fastdata_kv`, and it is a
  different standard with a JSON payload.
- a contract that stores a file itself: use that contract's own skill.
- anything the engine's swap queue does: use the general skill's
  `queue_swap.ts`.

---

#### MORE

- the engine skill for the queueing mechanics:
  [shit-1170-rex-engine](../shit-1170-rex-engine/SKILL.md)
- the FastFS facts come from `hackmd.io/@fastnear/fastfs-docs`,
  `github.com/fastnear/fastfs-server`,
  `github.com/fastnear/fastdata-indexer`
  (`fastfs-sub-indexer/src/fastfs.rs`),
  `github.com/fastnear/fastdata-drag-and-drop`
  (`src/hooks/fastfs.js`), and `near.social/standard.md`.

=====================
<br/>
copyright 2026 by sleet.near
