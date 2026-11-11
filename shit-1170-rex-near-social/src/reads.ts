// the READ side of near.social.
//
// --- THE ARCHITECTURE ---
// a read goes to the indexer API, directly. no API key, no engine
// account, no wallet. the client is
// `@sleet-js/middleman-near-social-api` — the typed client for
// https://api2.near.social — and it is the source of truth for the
// endpoint shapes.
//
// the API is READ-ONLY. it serves what the indexer has seen of the
// social-kv/1 writes, and it never writes anything. every write is a
// NEAR transaction, queued through the engine and signed by a human.
//
// --- WHY THE MIDDLEMAN AND NOT A HAND-ROLLED FETCH ---
// the middleman is one typed function per endpoint, and one type per
// response shape. so the shape a bin sends is the shape the server
// answers with, and a change to the API is a change in one place.
//
// --- THE API IS MAINNET-ONLY ---
// there is no testnet variant to point the base url at, so there is
// no `--network` flag on the read bins. near.social is mainnet.

import { quiet_fun } from "@huggies/shit-1170-rex-engine-middleman";
import {
  api_near_social_account,
  api_near_social_account_followers,
  api_near_social_account_following,
  api_near_social_account_likes,
  api_near_social_account_media,
  api_near_social_account_posts,
  api_near_social_account_replies,
  api_near_social_feed_following,
  api_near_social_feed_for_you,
  api_near_social_feed_global,
  api_near_social_hashtag_feed,
  api_near_social_hashtags_trending,
  api_near_social_notifications,
  api_near_social_notifications_count,
  api_near_social_post,
  api_near_social_post_likes,
  api_near_social_post_preview,
  api_near_social_post_quotes,
  api_near_social_post_replies,
  api_near_social_post_reposts,
  api_near_social_posts_batch,
  api_near_social_search_accounts,
  api_near_social_search_posts,
  api_near_social_status,
  api_near_social_suggestions,
  api_near_social_tx,
  type NEAR_SOCIAL_ACCOUNT_CARD,
  type NEAR_SOCIAL_ACCOUNT_SUMMARY,
  type NEAR_SOCIAL_BATCH_RESPONSE,
  type NEAR_SOCIAL_FEED_ITEM,
  type NEAR_SOCIAL_HASHTAG,
  type NEAR_SOCIAL_LINK,
  type NEAR_SOCIAL_NOTIFICATION,
  type NEAR_SOCIAL_NOTIFICATIONS_COUNT,
  type NEAR_SOCIAL_PAGE,
  type NEAR_SOCIAL_POST,
  type NEAR_SOCIAL_PROFILE,
  type NEAR_SOCIAL_STATUS,
  type NEAR_SOCIAL_THREAD,
  type NEAR_SOCIAL_TX,
} from "@sleet-js/middleman-near-social-api";

export type {
  NEAR_SOCIAL_ACCOUNT_CARD,
  NEAR_SOCIAL_ACCOUNT_SUMMARY,
  NEAR_SOCIAL_BATCH_RESPONSE,
  NEAR_SOCIAL_FEED_ITEM,
  NEAR_SOCIAL_HASHTAG,
  NEAR_SOCIAL_LINK,
  NEAR_SOCIAL_NOTIFICATION,
  NEAR_SOCIAL_NOTIFICATIONS_COUNT,
  NEAR_SOCIAL_PAGE,
  NEAR_SOCIAL_POST,
  NEAR_SOCIAL_PROFILE,
  NEAR_SOCIAL_STATUS,
  NEAR_SOCIAL_THREAD,
  NEAR_SOCIAL_TX,
};

// the list endpoints answer with `{ items, next_cursor }` and take
// `limit` (1..100) and `cursor`.
export interface SHIT_1170_SOCIAL_PAGE_PARAMS {
  limit?: number;
  cursor?: string;
  viewer?: string;
}

// how far the indexer has got on the chain.
export async function shit_1170_social_status_fun(): Promise<NEAR_SOCIAL_STATUS> {
  return quiet_fun(() =>
    api_near_social_status(),
  );
}

// an account's profile.
export async function shit_1170_social_account_fun(
  account_id: string,
  viewer?: string,
): Promise<NEAR_SOCIAL_PROFILE> {
  return quiet_fun(() =>
    api_near_social_account({ account_id, viewer }),
  );
}

// the home feed — trending, mixed with the accounts the viewer follows.
export async function shit_1170_social_feed_for_you_fun(
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_feed_for_you({
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// every top-level post, newest first.
export async function shit_1170_social_feed_global_fun(
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_feed_global({
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the account's own home feed — the accounts it follows, and itself.
export async function shit_1170_social_feed_following_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_feed_following({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the posts with a hashtag.
export async function shit_1170_social_hashtag_feed_fun(
  tag: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_hashtag_feed({
    tag,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the top hashtags over the last day.
export async function shit_1170_social_hashtags_trending_fun(): Promise<
  NEAR_SOCIAL_PAGE<NEAR_SOCIAL_HASHTAG>
> {
  return quiet_fun(() =>
    api_near_social_hashtags_trending(),
  );
}

// an account's posts and reposts.
export async function shit_1170_social_account_posts_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_account_posts({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// an account's replies.
export async function shit_1170_social_account_replies_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_account_replies({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// an account's posts that carry media.
export async function shit_1170_social_account_media_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_account_media({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the posts an account liked.
export async function shit_1170_social_account_likes_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_account_likes({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// who follows an account.
export async function shit_1170_social_account_followers_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_ACCOUNT_CARD>> {
  return quiet_fun(() =>
    api_near_social_account_followers({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// who an account follows.
export async function shit_1170_social_account_following_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_ACCOUNT_CARD>> {
  return quiet_fun(() =>
    api_near_social_account_following({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the posts whose text contains a query.
export async function shit_1170_social_search_posts_fun(
  q: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_search_posts({
    q,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the accounts matching a query.
export async function shit_1170_social_search_accounts_fun(
  q: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_ACCOUNT_CARD>> {
  return quiet_fun(() =>
    api_near_social_search_accounts({
    q,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the accounts to follow.
export async function shit_1170_social_suggestions_fun(
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_ACCOUNT_CARD>> {
  return quiet_fun(() =>
    api_near_social_suggestions({
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// one post, with the chain of ancestors it replies to.
export async function shit_1170_social_post_fun(
  account_id: string,
  post_id: string,
  viewer?: string,
): Promise<NEAR_SOCIAL_THREAD> {
  return quiet_fun(() =>
    api_near_social_post({ account_id, post_id, viewer }),
  );
}

// the replies to a post.
export async function shit_1170_social_post_replies_fun(
  account_id: string,
  post_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_post_replies({
    account_id,
    post_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the posts that quote a post.
export async function shit_1170_social_post_quotes_fun(
  account_id: string,
  post_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_FEED_ITEM>> {
  return quiet_fun(() =>
    api_near_social_post_quotes({
    account_id,
    post_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the accounts that liked a post.
export async function shit_1170_social_post_likes_fun(
  account_id: string,
  post_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_ACCOUNT_CARD>> {
  return quiet_fun(() =>
    api_near_social_post_likes({
    account_id,
    post_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the accounts that reposted a post.
export async function shit_1170_social_post_reposts_fun(
  account_id: string,
  post_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_ACCOUNT_CARD>> {
  return quiet_fun(() =>
    api_near_social_post_reposts({
    account_id,
    post_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// the link preview for a post's url.
export async function shit_1170_social_post_preview_fun(
  account_id: string,
  post_id: string,
): Promise<NEAR_SOCIAL_LINK> {
  return quiet_fun(() =>
    api_near_social_post_preview({ account_id, post_id }),
  );
}

// many posts by key, in one request.
export async function shit_1170_social_posts_batch_fun(
  keys: string[],
  viewer?: string,
): Promise<NEAR_SOCIAL_BATCH_RESPONSE> {
  return quiet_fun(() =>
    api_near_social_posts_batch({ keys, viewer }),
  );
}

// an account's notifications.
export async function shit_1170_social_notifications_fun(
  account_id: string,
  params: SHIT_1170_SOCIAL_PAGE_PARAMS & { since?: number } = {},
): Promise<NEAR_SOCIAL_PAGE<NEAR_SOCIAL_NOTIFICATION>> {
  return quiet_fun(() =>
    api_near_social_notifications({
    account_id,
    limit: params.limit,
    cursor: params.cursor,
    viewer: params.viewer,
  }),
  );
}

// how many notifications the account has newer than `since`.
export async function shit_1170_social_notifications_count_fun(
  account_id: string,
  since?: number,
): Promise<NEAR_SOCIAL_NOTIFICATIONS_COUNT> {
  return quiet_fun(() =>
    api_near_social_notifications_count({ account_id, since }),
  );
}

// what the indexer did with a transaction's writes.
//
// this is the answer after a human signs: `indexed: false` means the
// indexer has not seen it yet, and every key carries its own status.
export async function shit_1170_social_tx_fun(
  tx_hash: string,
): Promise<NEAR_SOCIAL_TX> {
  return quiet_fun(() =>
    api_near_social_tx({ tx_hash }),
  );
}
