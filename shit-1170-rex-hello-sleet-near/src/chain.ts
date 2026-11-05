// the chain reads the hello.sleet.near bins need.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the only
// chain access here is VIEW reads.
//
// these reads go through the near-kit tool box:
//   `@near-kit-tool-box/fun` — typed helpers, Zod-validated answers
//   `@near-kit-tool-box/env` — the server-side client setup
//
// the client is built here rather than taken from the env package,
// because the env package defaults to testnet and these skills
// default to MAINNET. `new Near({ network })` says what we mean.
//
// --- WHY THERE IS NO HAND-ROLLED RPC HERE ---
// the old version posted to `rpc.mainnet.near.org` and decoded the
// answer by hand. that endpoint is DEPRECATED and now answers
// "THIS ENDPOINT IS DEPRECATED!". near-kit already picks a working
// public endpoint per network (`free.rpc.fastnear.com` for mainnet,
// `rpc.testnet.fastnear.com` for testnet) and decodes the answer.

import { Near } from "near-kit";
import { generic_contract_view_fun_json } from "@near-kit-tool-box/fun";

export type SHIT_1170_NETWORK = "mainnet" | "testnet";

/**
 * the network a flag named.
 *
 * anything that is not "testnet" is mainnet — the skills default to
 * mainnet because the contracts people talk about live there.
 */
export function shit_1170_network_fun(
  network: string | undefined,
): SHIT_1170_NETWORK {
  return network === "testnet" ? "testnet" : "mainnet";
}

/**
 * a NEAR client for one network.
 *
 * the client is read-only here: it has no signer and no private key,
 * so it can only answer views.
 */
export function shit_1170_near_client_fun(
  network: SHIT_1170_NETWORK = "mainnet",
): Near {
  return new Near({ network });
}

// --- THE MISSING-METHOD QUESTION ---
//
// a probe that fails because the ARGUMENTS were wrong still proves
// the method exists: the contract resolved it and ran it. only a
// method the contract does not have at all means the method is
// missing.
//
//   missing:   "wasm execution failed with error: MethodResolveError(MethodNotFound)"
//   wrong args: "HostError(GuestPanic { panic_msg: \"Failed to deserialize
//                input from JSON...\" })"
const SHIT_1170_METHOD_MISSING = /MethodNotFound|MethodResolveError/i;

/**
 * a view call that ran and failed.
 *
 * `missing` is true only when the contract does not have the method
 * at all. a call that failed because the ARGUMENTS were wrong is NOT
 * missing: the method resolved and ran, so it exists.
 */
export class SHIT_1170_VIEW_CALL_ERROR extends Error {
  readonly missing: boolean;

  constructor(message: string, missing: boolean) {
    super(message);
    this.name = "SHIT_1170_VIEW_CALL_ERROR";
    this.missing = missing;
  }
}

function shit_1170_error_message_fun(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * one view call, with the args written as json for you.
 *
 * a call that ran and failed throws a `SHIT_1170_VIEW_CALL_ERROR`,
 * which says whether the method was missing.
 */
export async function shit_1170_view_fun<T>(
  network: SHIT_1170_NETWORK,
  contract_id: string,
  method_name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await generic_contract_view_fun_json<T>(
      shit_1170_near_client_fun(network),
      contract_id,
      method_name,
      args,
    );
  } catch (error) {
    const message = shit_1170_error_message_fun(error);
    throw new SHIT_1170_VIEW_CALL_ERROR(
      message,
      SHIT_1170_METHOD_MISSING.test(message),
    );
  }
}
