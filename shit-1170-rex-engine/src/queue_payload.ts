// the shape the engine's tx-queue accepts.
//
// the agent NEVER sends a transaction. it builds a payload and the
// engine queues it for a human to sign in the web app.
//
// this is NOT a near-kit transaction and NOT a `near.call`. it is
// data.

/**
 * one queued function call.
 *
 * `gas` and `deposit` are raw digit strings: gas units and yoctoNEAR.
 * the web app's `shared/gas_deposit.ts` also accepts near-kit's human
 * forms ("30 Tgas", "0.00125 NEAR", "1 yocto") and converts them, so
 * a hand-written payload may use either — but raw digits are the
 * unambiguous form and are what this helper emits.
 */
export interface SHIT_1170_QUEUE_CALL {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}

export interface SHIT_1170_QUEUE_CALL_INPUT {
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
  gas?: string;
  deposit?: string;
}

// 30 Tgas, the usual ceiling for a call that does real work.
export const SHIT_1170_DEFAULT_GAS = "30000000000000";
// no native NEAR attached.
export const SHIT_1170_DEFAULT_DEPOSIT = "0";

// raw digits only. "30 Tgas" and "0.00125 NEAR" are human forms the
// web app converts, but the queue payload itself carries raw units.
function shit_1170_raw_amount_fun(value: string, field: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${field} must be a raw digit string (gas units or yoctoNEAR), got "${value}"`,
    );
  }
  return trimmed;
}

/**
 * build one queue payload.
 *
 * this does NOT send anything. it returns the data the engine queues
 * for a human to sign.
 */
export function shit_1170_queue_call_fun(
  input: SHIT_1170_QUEUE_CALL_INPUT,
): SHIT_1170_QUEUE_CALL {
  const contractId = input.contractId?.trim() ?? "";
  if (contractId.length === 0) {
    throw new Error("contractId is required");
  }

  const method = input.method?.trim() ?? "";
  if (method.length === 0) {
    throw new Error("method is required");
  }

  const args = input.args ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("args must be a plain object");
  }

  const gas = shit_1170_raw_amount_fun(
    input.gas ?? SHIT_1170_DEFAULT_GAS,
    "gas",
  );
  const deposit = shit_1170_raw_amount_fun(
    input.deposit ?? SHIT_1170_DEFAULT_DEPOSIT,
    "deposit",
  );

  return { contractId, method, args, gas, deposit };
}

/**
 * the shape the engine's SWAP queue accepts.
 *
 * a swap names the token sold, the raw amount sold, and the token
 * bought. the route is worked out when a human executes it.
 */
export interface SHIT_1170_QUEUE_SWAP {
  tokenIn: string;
  amountIn: string;
  tokenOut: string;
  amountOut?: string;
  dexId?: string;
  what?: string;
  when?: string;
  why?: string;
  whenAt?: number;
  accounts?: string[];
}
