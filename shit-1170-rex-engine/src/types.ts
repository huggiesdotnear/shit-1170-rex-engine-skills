export interface SHIT_1170_ACCOUNT_PROFILE {
  accountId: string;
  apiKey: string;
  baseUrl?: string;
  label?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface SHIT_1170_LOCAL_QUEUE_RECORD {
  kind: "tx" | "swap";
  id: string;
  createdAt: number;
  updatedAt: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  localPath: string;
}

export interface SHIT_1170_LOCAL_QUEUES_FILE {
  records: SHIT_1170_LOCAL_QUEUE_RECORD[];
}

export interface SHIT_1170_SYNC_RESULT {
  kind: "tx" | "swap";
  id: string;
  changed: boolean;
  /** the whole server object, not a status */
  server: Record<string, unknown>;
}
