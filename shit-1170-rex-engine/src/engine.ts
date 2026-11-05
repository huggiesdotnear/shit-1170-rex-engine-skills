import {
  api_shit_1170_api_key_me_get,
  api_shit_1170_tx_queue_get,
  api_shit_1170_tx_queue_one_get,
  api_shit_1170_tx_queue_post,
  api_shit_1170_swap_queue_get,
  api_shit_1170_swap_queue_one_get,
  api_shit_1170_swap_queue_post,
  type SHIT_1170_SWAP_QUEUE_QUERY,
  type SHIT_1170_SWAP_QUEUE_REQUEST,
  type SHIT_1170_TX_QUEUE,
  type SHIT_1170_TX_QUEUE_QUERY,
  type SHIT_1170_TX_QUEUE_REQUEST,
} from "@huggies/shit-1170-rex-engine-middleman";
import { shit_1170_queue_record_put_fun } from "./local_queue";
import { shit_1170_quiet_fun } from "./json_io";

export const SHIT_1170_DEFAULT_BASE_URL = "https://shit-1170.com";

export function shit_1170_base_url_fun(baseUrl?: string): string {
  return (baseUrl ?? SHIT_1170_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export async function shit_1170_queue_tx_fun(
  apiKey: string,
  body: SHIT_1170_TX_QUEUE_REQUEST,
  options: { baseUrl?: string } = {},
): Promise<{ queue: SHIT_1170_TX_QUEUE; localPath: string }> {
  const baseUrl = shit_1170_base_url_fun(options.baseUrl);
  const queue = await shit_1170_quiet_fun(() =>
    api_shit_1170_tx_queue_post(baseUrl, body, {
      api_key: apiKey,
    }),
  );
  const local = await shit_1170_queue_record_put_fun({
    kind: "tx",
    id: queue.queueId,
    request: body as unknown as Record<string, unknown>,
    response: queue as unknown as Record<string, unknown>,
  });
  return { queue, localPath: local.localPath };
}

export async function shit_1170_queue_swap_fun(
  apiKey: string,
  body: SHIT_1170_SWAP_QUEUE_REQUEST,
  options: { baseUrl?: string } = {},
): Promise<{ queue: Record<string, unknown>; localPath: string }> {
  const baseUrl = shit_1170_base_url_fun(options.baseUrl);
  const queue = await shit_1170_quiet_fun(() =>
    api_shit_1170_swap_queue_post(baseUrl, body, {
      api_key: apiKey,
    }),
  );
  const local = await shit_1170_queue_record_put_fun({
    kind: "swap",
    id: queue.swapId,
    request: body as unknown as Record<string, unknown>,
    response: queue as unknown as Record<string, unknown>,
  });
  return { queue: queue as unknown as Record<string, unknown>, localPath: local.localPath };
}

export async function shit_1170_tx_get_fun(
  queueId: string,
  options: { baseUrl?: string } = {},
): Promise<SHIT_1170_TX_QUEUE> {
  return shit_1170_quiet_fun(() =>
    api_shit_1170_tx_queue_one_get(
      shit_1170_base_url_fun(options.baseUrl),
      queueId,
    ),
  );
}

export async function shit_1170_swap_get_fun(
  swapId: string,
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await shit_1170_quiet_fun(() =>
    api_shit_1170_swap_queue_one_get(
      shit_1170_base_url_fun(options.baseUrl),
      swapId,
    ),
  );
  return result as unknown as Record<string, unknown>;
}

export async function shit_1170_tx_list_fun(
  query: SHIT_1170_TX_QUEUE_QUERY = {},
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await shit_1170_quiet_fun(() =>
    api_shit_1170_tx_queue_get(
      shit_1170_base_url_fun(options.baseUrl),
      query,
    ),
  );
  return result as unknown as Record<string, unknown>;
}

export async function shit_1170_swap_list_fun(
  query: SHIT_1170_SWAP_QUEUE_QUERY = {},
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await shit_1170_quiet_fun(() =>
    api_shit_1170_swap_queue_get(
      shit_1170_base_url_fun(options.baseUrl),
      query,
    ),
  );
  return result as unknown as Record<string, unknown>;
}

export async function shit_1170_api_key_me_fun(
  apiKey: string,
  options: { baseUrl?: string } = {},
): Promise<Record<string, unknown>> {
  const result = await shit_1170_quiet_fun(() =>
    api_shit_1170_api_key_me_get(
      shit_1170_base_url_fun(options.baseUrl),
      { api_key: apiKey },
    ),
  );
  return result as unknown as Record<string, unknown>;
}
