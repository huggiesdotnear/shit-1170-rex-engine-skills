// ========================================
// SHIT 1170 REX UNIT CONVERSION
// agent friendly unit conversion for near tokens.
//
// turn a human amount ("1.5") into the chain's unit amount
// ("1500000000000000000000000") and back, using the token's real
// decimals from the intear api.
// ========================================

export {
  human_to_unit_fun,
  unit_to_human_fun,
  unit_to_raw_human_fun,
} from "./unit_conversion";
export type { UNIT_CONVERSION_DECIMALS } from "./unit_conversion";

export { unit_conversion_token_info_fun } from "./token_decimals";
export type { UNIT_CONVERSION_TOKEN_INFO } from "./token_decimals";
export {
  UNIT_CONVERSION_NEAR_ID,
  UNIT_CONVERSION_NEAR_DECIMALS,
  UNIT_CONVERSION_WRAP_ID,
} from "./token_decimals";
// ========================================
// copyright 2026 by sleet.near
