import {
  generateKey,
  generateSeedPhrase,
  parseSeedPhrase,
  type SeedPhraseWordCount,
} from "near-kit";

import type { SHIT_1170_KEY_GENERATED } from "./types";

// making a key pair.
//
// --- WHY THERE ARE TWO WAYS TO MAKE A KEY ---
// the frontend's keys page makes its key with `generateKey()`, which
// produces a RANDOM ed25519 secret. there is no phrase that recovers
// it. that is the default here too, so an agent's key behaves exactly
// like the one the browser makes.
//
// `generateSeedPhrase()` + `parseSeedPhrase()` is the other way: a
// BIP-39 phrase is generated, and the key is DERIVED from it with
// SLIP-0010 at NEAR's path `m/44'/397'/0'`. the phrase recovers the
// key, so it can be written down and the key restored later.
//
// near-kit already ships both, and its derivation is compatible with
// the NEAR CLI and with NEAR wallets, so nothing else is needed here.
//
// --- WHY THE SEED PHRASE IS OPT-IN ---
// a random key has one secret and one copy of it. a phrase-derived key
// has a phrase that recovers the whole thing, and a phrase is the kind
// of thing people write on paper. making it the default would put a
// recovery phrase in every agent run's store for no reason. the caller
// asks for it with `--seed`.
//
// --- WHY THE DERIVATION PATH IS THE DEFAULT ONE ---
// `m/44'/397'/0'` is NEAR's coin type, so the phrase recovers the key
// in the NEAR CLI and in NEAR wallets too. a different path is a
// different key, and it is recorded so the key can be restored.

/** the BIP-32 path NEAR uses. */
export const SHIT_1170_KEY_DEFAULT_PATH = "m/44'/397'/0'";

/** the word counts a BIP-39 phrase may have. */
export const SHIT_1170_KEY_WORD_COUNTS: readonly SeedPhraseWordCount[] = [
  12,
  15,
  18,
  21,
  24,
];

export interface SHIT_1170_KEY_MAKE_INPUT {
  /**
   * make the key from a seed phrase instead of at random.
   *
   * the phrase is generated here and the key is derived from it.
   */
  seed?: boolean;
  /** how many words the phrase has. default 12. */
  word_count?: SeedPhraseWordCount;
  /** the derivation path. default NEAR's `m/44'/397'/0'`. */
  path?: string;
}

export interface SHIT_1170_KEY_MADE {
  public_key: string;
  secret_key: string;
  seed_phrase: string | null;
  derivation_path: string | null;
}

/**
 * make a new key pair.
 *
 * a random key has no phrase and no path. a phrase-derived key has
 * both, and the phrase recovers the key.
 */
export function shit_1170_key_make_fun(
  input: SHIT_1170_KEY_MAKE_INPUT = {},
): SHIT_1170_KEY_MADE {
  if (!input.seed) {
    const pair = generateKey();
    return {
      public_key: pair.publicKey.toString(),
      secret_key: pair.secretKey,
      seed_phrase: null,
      derivation_path: null,
    };
  }

  const wordCount = input.word_count ?? 12;
  if (!SHIT_1170_KEY_WORD_COUNTS.includes(wordCount)) {
    throw new Error(
      `--word-count must be one of ${SHIT_1170_KEY_WORD_COUNTS.join(", ")}, got ${wordCount}`,
    );
  }
  const path = input.path ?? SHIT_1170_KEY_DEFAULT_PATH;

  const phrase = generateSeedPhrase(wordCount);
  const pair = parseSeedPhrase(phrase, path);

  return {
    public_key: pair.publicKey.toString(),
    secret_key: pair.secretKey,
    seed_phrase: phrase,
    derivation_path: path,
  };
}

/**
 * turn a made key into the record the local store keeps.
 */
export function shit_1170_key_generated_of_fun(
  made: SHIT_1170_KEY_MADE,
): SHIT_1170_KEY_GENERATED {
  return {
    id: made.public_key,
    public_key: made.public_key,
    secret_key: made.secret_key,
    seed_phrase: made.seed_phrase,
    derivation_path: made.derivation_path,
    created_at: Date.now(),
  };
}
