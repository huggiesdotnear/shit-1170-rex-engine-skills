// near.social, as the rex engine needs it: the reads from the
// indexer API and the social-kv/1 queue payloads a human signs.
//
// --- THE ARCHITECTURE ---
// a READ goes to the indexer API, directly: no API key, no engine
// account, no wallet. the client is
// `@sleet-js/middleman-near-social-api`.
//
// a WRITE is queued in the shit-1170 rex engine as a generic
// function call, and a HUMAN signs it in the web app with their
// wallet. so the write side is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// the split is the whole point: the agent can read everything on
// near.social, and can prepare every post, but it can publish
// nothing on its own.
//
// --- THE RECEIPT FAILS, AND THAT IS CORRECT ---
// a social write is a `__fastdata_kv` call on the `social` account.
// there is no contract on that account, so the receipt fails with
// `CodeDoesNotExist`. that is the expected shape of a successful
// write: the FastData indexer reads the transaction's args and does
// not look at the receipt status. the answer is the indexer, not the
// receipt — `GET /v1/tx/{tx_hash}`.
//
// --- WHERE THE FACTS COME FROM ---
// the standard: <https://near.social/standard.md>
// the api: <https://api2.near.social/api.md>

export * from "./reads";
export * from "./social_kv";
