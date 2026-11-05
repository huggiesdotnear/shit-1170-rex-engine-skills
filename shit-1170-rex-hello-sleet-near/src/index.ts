// the hello.sleet.near greeting contract, as the rex engine needs it.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the write
// side of this skill is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// --- WHY THE GAS IS WHERE IT IS ---
// the contract's own gas is 3 Tgas and its deposit is 0. both are
// confirmed by the contract's documented interface. the defaults here
// are those values, so a queued call and a documented call agree.

import {
  greeting_contractid,
  greeting_methods_const,
} from "@near-kit-tool-box/fun";
import { shit_1170_queue_call_fun } from "./queue_payload";
import type { SHIT_1170_QUEUE_CALL } from "./queue_payload";

export type { SHIT_1170_QUEUE_CALL };

export const SHIT_1170_HELLO_CONTRACT_IDS = {
  mainnet: "hello.sleet.near",
  testnet: "hello.sleet.testnet",
} as const;

export type SHIT_1170_HELLO_NETWORK = keyof typeof SHIT_1170_HELLO_CONTRACT_IDS;

export const SHIT_1170_HELLO_SET_GREETING_GAS = "3000000000000";
export const SHIT_1170_HELLO_SET_GREETING_DEPOSIT = "0";

export const SHIT_1170_HELLO_METHODS = {
  get_greeting: "view",
  set_greeting: "call",
} as const;

export type SHIT_1170_HELLO_METHOD = keyof typeof SHIT_1170_HELLO_METHODS;

export function shit_1170_hello_contract_id_fun(
  network: SHIT_1170_HELLO_NETWORK = "mainnet",
): string {
  // the tool box owns the id table: `hello.sleet.near` on mainnet,
  // `hello.sleet.testnet` on testnet.
  return greeting_contractid(network);
}

// get_greeting takes no arguments.
export function shit_1170_hello_get_greeting_args_fun(): Record<
  string,
  unknown
> {
  return {};
}

// set_greeting takes one argument: the greeting itself.
export function shit_1170_hello_set_greeting_args_fun(
  greeting: string,
): Record<string, unknown> {
  const text = greeting.trim();
  if (!text) throw new Error("greeting is required");
  return { greeting: text };
}

// the write is a QUEUE PAYLOAD, not a transaction. the engine queues
// it and a human signs it.
export function shit_1170_hello_set_greeting_queue_call_fun(
  greeting: string,
  options: {
    network?: SHIT_1170_HELLO_NETWORK;
    contractId?: string;
    gas?: string;
    deposit?: string;
  } = {},
): SHIT_1170_QUEUE_CALL {
  return shit_1170_queue_call_fun({
    contractId:
      options.contractId ?? shit_1170_hello_contract_id_fun(options.network),
    method: greeting_methods_const.set_greeting,
    args: shit_1170_hello_set_greeting_args_fun(greeting),
    gas: options.gas ?? SHIT_1170_HELLO_SET_GREETING_GAS,
    deposit: options.deposit ?? SHIT_1170_HELLO_SET_GREETING_DEPOSIT,
  });
}
