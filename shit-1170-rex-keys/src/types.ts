// the shapes this skill writes down.
//
// --- WHY THE GENERATED KEY AND THE ADDED KEY ARE DIFFERENT TYPES ---
// they answer different questions and they live in different places.
//
// a GENERATED key is a key pair this agent made. it knows the public
// key, the private key, and optionally the seed phrase it was derived
// from. it knows NOTHING about what the key may call, because at the
// moment it was made nobody had said.
//
// an ADDED key is a key that was offered to an account. it knows the
// contract it may call, the methods it may call there, the allowance,
// and the queue it went out in. it points back at the generated key
// that holds the secret.
//
// --- WHY THE ADDED KEY POINTS AT THE GENERATED ONE ---
// the private key lives in exactly ONE place: the sqlite row of the
// generated key. the added key's json file holds the public key and
// the details, and the sqlite row id. so the secret is written once
// and the two records agree about which key it is.

/**
 * a key pair this agent generated.
 */
export interface SHIT_1170_KEY_GENERATED {
  /** the sqlite row id. it is the public key. */
  id: string;
  /** `ed25519:...` — the public key. */
  public_key: string;
  /** `ed25519:...` — the private key. the only copy of the secret. */
  secret_key: string;
  /**
   * the BIP-39 seed phrase, when the key was derived from one.
   *
   * null for a random key: `generateKey()` produces a random secret and
   * there is no phrase that recovers it.
   */
  seed_phrase: string | null;
  /** the BIP-32 path the key was derived at, when there was a phrase. */
  derivation_path: string | null;
  /** when the key was made. milliseconds since the epoch. */
  created_at: number;
}

/**
 * a key that was queued to be added to, or removed from, an account.
 */
export interface SHIT_1170_KEY_ADDED {
  /** `ed25519:...` — the public key this is about. */
  public_key: string;
  /** the account the key was queued for. */
  account_id: string;
  /** `add_key` or `delete_key`. */
  action: string;
  /** the contract the key may call. null for a removal. */
  receiver_id: string | null;
  /** the methods the key may call. empty means every method. */
  method_names: string[];
  /**
   * the gas budget in yoctoNEAR.
   *
   * null means the key was offered with NO allowance, and the protocol
   * reads an absent allowance as UNLIMITED gas. it never means "no gas
   * allowed" — a zero allowance is refused at queue time.
   */
  allowance: string | null;
  /** the queue id the action went out in, when it went out. */
  queue_id: string | null;
  /** the engine's own transaction id for that action. */
  tx_id: string | null;
  /** the local copy of the queued batch, when there is one. */
  local_path: string | null;
  /** when the action was queued. milliseconds since the epoch. */
  created_at: number;
  /** the last time this record was touched. */
  updated_at: number;
}

/**
 * one access key read off the chain.
 */
export interface SHIT_1170_KEY_ON_CHAIN {
  /** `ed25519:...` — the public key. */
  public_key: string;
  /** true when the key can do anything — it IS the account. */
  full_access: boolean;
  /** the contract the key may call. null for a full access key. */
  receiver_id: string | null;
  /** the methods the key may call. empty means every method. */
  method_names: string[];
  /**
   * the gas budget in yoctoNEAR, as the chain reports it.
   *
   * null means the key has NO allowance field, which the protocol reads
   * as unlimited gas.
   */
  allowance: string | null;
  /** the nonce of the key. */
  nonce: number;
  /**
   * true when this agent holds the private key for it.
   *
   * it is the agent's own store that answers this, so the answer is
   * about the agent's machine and not about the chain.
   */
  held_locally: boolean;
}
