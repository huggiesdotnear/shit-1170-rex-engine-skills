# shit-1170-rex-fastfs

FastFS file uploads for the shit-1170 rex engine.

FastFS is FastData's file standard. a file is uploaded by a NEAR
transaction whose bytes the FastData indexer picks up and serves over
http.

**the agent prepares the payload and the human signs it.** the receipt
of a FastFS upload fails by design — the receiver has no contract, and
the indexer reads the transaction rather than the receipt. verify
through the serving URL.

- the skill: [SKILL.md](./SKILL.md)
- the engine skill, for the queueing mechanics:
  [shit-1170-rex-engine](../shit-1170-rex-engine/SKILL.md)

## the bins

```sh
# what does this file need?
bun bin/fastfs_check.ts --file ./picture.png

# the queue payload for a human to sign
bun bin/fastfs_upload.ts --file ./picture.png

# where will the file be served from?
bun bin/fastfs_url.ts --predecessor alice.near --relative-path picture.png

# is it there yet?
bun bin/fastfs_status.ts --predecessor alice.near --relative-path picture.png --for 120

# what did a signed upload actually put up?
bun bin/fastfs_tx.ts --tx-hash <hash>
```

## reading a file back off a transaction

`fastfs_tx.ts` works on a transaction on chain, where the other bins
work on a file on disk. it reports what the transaction uploaded: the
path, the mime, the size, whether it was a delete, the serving URL and
the `fastfs://` URI, and every limit the payload breaks.

it reads the bytes through `@sleet-js/fastnear-explorer-api-client` —
the same package the engine's web app uses. the explorer's decoder
**never throws**: a payload that is not FastFS borsh decodes to `null`,
so a transaction with no FastFS upload in it is a normal answer.

the content is left out of the output. a 121 KB png is 162 KB of
base64 on stdout, and it buries the facts. `--with-content` asks for
it explicitly.

## the bytes have to reach the wallet as bytes

the args are bytes. if they pass through `JSON.stringify` on the way
to the wallet, they become the json text of a byte map:

```text
{"0":0,"1":15,"10":47,"11":115,…}
```

the indexer reads the action's args with `borsh::from_slice`, so that
is not borsh, and **the action is dropped silently** — no error, the
receipt fails the way a FastFS receipt always fails, and the file
never appears at its URL.

a FastFS upload goes out through the **Intear Wallet**, and only
through it. the engine's web app refuses a byte-carrying call for any
other wallet, so a dropped upload does not happen through the app.

## the borsh payload

the args are **raw borsh bytes**, not a JSON object. the enum's variant
index is one byte, a `String` and a `Vec<u8>` are a u32 length prefix
plus their bytes, an `Option<T>` is one byte plus the value, and every
integer is little-endian.

a small example — the payload for `hello.txt` holding `hi`:

```text
0000  00 09 00 00 00 68 65 6c 6c 6f 2e 74 78 74 01 0a
0010  00 00 00 74 65 78 74 2f 70 6c 61 69 6e 02 00 00
0020  00 68 69
```

read it as:

| bytes | what |
| --- | --- |
| `00` | the enum variant index — `0` is `Simple` |
| `09 00 00 00` | the relative path's length, 9 |
| `68 65 6c 6c 6f 2e 74 78 74` | `hello.txt` |
| `01` | the `Option` is `Some` |
| `0a 00 00 00` | the mime type's length, 10 |
| `74 65 78 74 2f 70 6c 61 69 6e` | `text/plain` |
| `02 00 00 00` | the content's length, 2 |
| `68 69` | the two content bytes |

## the encoder is checked against a real mainnet transaction

the reference transaction
`5vUqtNhYchWyrifviVZ9F6k4QprgfW9fjSAtcGMdQyRw` uploaded
`fastnear.png` to `fastfs.near`, signed by `mob.near`, with gas `1`
and deposit `0`. its args, base64-decoded, start:

```text
00 0c 00 00 00 66 61 73 74 6e 65 61 72 2e 70 6e 67 01 09 00 00
00 69 6d 61 67 65 2f 70 6e 67 85 da 01 00 89 50 4e 47 ...
```

`00` — Simple. `0c 00 00 00` — the path is 12 characters:
`fastnear.png`. `01` — there is content. `09 00 00 00` — the mime is
9 characters: `image/png`. `85 da 01 00` — the content is 121477
bytes. `89 50 4e 47` — the PNG magic.

`src/fastfs.ts` decodes those bytes back to exactly those values, and
re-encoding them reproduces the transaction's args **byte for byte**.

```sh
bun -e '
import { readFileSync } from "node:fs";
import { shit_1170_fastfs_decode_fun, shit_1170_fastfs_simple_bytes_fun }
  from "./src/index";

const answer = await fetch("https://tx.main.fastnear.com/v0/transactions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tx_hashes: ["5vUqtNhYchWyrifviVZ9F6k4QprgfW9fjSAtcGMdQyRw"] }),
});
const json = await answer.json();
const raw = new Uint8Array(Buffer.from(
  json.transactions[0].transaction.actions[0].FunctionCall.args, "base64"));

const data = shit_1170_fastfs_decode_fun(raw);
console.log(data.kind, data.relativePath, data.content.mimeType, data.content.content.length);

const re = shit_1170_fastfs_simple_bytes_fun(
  data.relativePath, data.content.mimeType, data.content.content);
console.log("byte-identical:", Buffer.from(re).equals(Buffer.from(raw)));
'
```

## the sources

the facts come from the primary sources, not from a summary of them:

- `hackmd.io/@fastnear/fastfs-docs` — the URL shape, the method, the
  schema, and the delete
- `github.com/fastnear/fastfs-server` — how the file is served, and
  how the chunks are put back together
- `github.com/fastnear/fastdata-indexer`
  (`fastfs-sub-indexer/src/fastfs.rs`) — the borsh schema and the
  limits the indexer enforces
- `github.com/fastnear/fastdata-drag-and-drop`
  (`src/hooks/fastfs.js`) — the reference frontend's schema
- `near.social/standard.md` — the upload convention, the gas `1`, and
  the failed receipt
- the mainnet transaction `5vUqtNhYchWyrifviVZ9F6k4QprgfW9fjSAtcGMdQyRw`
  — the wire format, byte for byte

=====================
<br/>
copyright 2026 by sleet.near
