// FastFS: upload a file to FastData's file standard through the
// shit-1170 rex engine.
//
// --- WHAT THIS SKILL OWNS ---
// the FastFS wire format — the borsh payload, the limits the indexer
// enforces, the serving URL — and the queue payloads an agent hands
// to a human to sign.
//
// --- WHAT THE ENGINE SKILL OWNS ---
// the queueing mechanics: how a payload reaches the engine, how the
// queue id and the signing link are reported, how the local copy is
// kept. that is the `shit-1170-rex-engine` skill, and this skill does
// not repeat it.
//
// --- THE RULE ---
// the agent NEVER calls a contract. a write is a QUEUE PAYLOAD for a
// HUMAN to sign in the web app. never `near.call`, never
// `generic_contract_call_fun`, never `generic_contract_call_wallet`.
//
// --- THE TRAP ---
// the receipt of a FastFS upload FAILS, and that is correct. the
// receiver has no contract, so the call cannot succeed, and the
// FastData indexer reads the TRANSACTION rather than the receipt's
// status. a failed receipt is not a broken upload.

export * from "./fastfs";
