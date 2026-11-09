// A transaction explorer for the shit-1170 rex engine.
//
// --- WHAT THIS SKILL OWNS ---
// reading an account's transaction history and reading a transaction's
// own detail, both from the FastNear transactions API, with the
// transactions that were read kept in a local sqlite store so the same
// one is never looked up twice.
//
// --- WHAT THE ENGINE SKILL OWNS ---
// the queueing mechanics: how a payload reaches the engine, how the
// queue id and the signing link are reported, how the local copy is
// kept. that is the `shit-1170-rex-engine` skill, and this skill does
// not repeat it.
//
// --- THE RULE ---
// the agent NEVER calls a contract. everything here is a READ.
//
// --- THE TWO ENDPOINTS ---
// the history endpoint gives an account's transactions with only the
// metadata of each one — the hash, the block, the timestamp, and the
// flags that say how the account was involved. the transaction
// endpoint gives a transaction's own detail: the actions, the
// receipts, the gas, the logs. one is a list of names, the other is
// the thing itself.

export * from "./paths";
export * from "./tx_db";
