// limited access keys for the shit-1170 rex engine.
//
// --- WHAT THIS SKILL OWNS ---
// making a limited access key, offering it to an account, taking it
// away again, and reading the keys an account already has.
//
// --- WHAT THE ENGINE SKILL OWNS ---
// the queueing mechanics in general: how a payload reaches the engine,
// how the queue id and the signing link are reported, how the local
// copy of a queued batch is kept. that is the `shit-1170-rex-engine`
// skill, and this skill does not repeat it.
//
// --- THE RULE ---
// the agent NEVER signs. a key that is added to an account is queued and
// a human approves it in the web app with their wallet, exactly like
// every other queued transaction.
//
// --- THE TWO STORES ---
// the sqlite file holds the SECRET of every key ever generated: the
// private key, and the seed phrase when there was one.
//
// the json files hold the DEAL: which account a key was offered to,
// which contract it may call, which methods, which allowance, and which
// queue it went out in.
//
// a key that was offered is in both, so it is saved twice, and the two
// copies cannot disagree about which key it is because the json file
// carries the public key.

export * from "./chain";
export * from "./key_make";
export * from "./keys_added";
export * from "./keys_db";
export * from "./paths";
export * from "./queue";
export * from "./types";
