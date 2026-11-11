// the bin primitives the near.social bins share.
//
// --- WHY THESE LIVE HERE ---
// the middleman is what makes stdout noisy — it logs every request
// and response with `console.log` — so the quieting and the
// printing belong next to the logging that makes them necessary.
// the engine middleman carries `quiet_fun` and `print_json_fun`.
//
// the page and the post shapes are here because every read bin
// answers with the same two shapes: a page of items with its
// cursor, and a list of posts. one formatter each means the bins do
// not drift apart.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  type ARGS,
} from "@huggies/shit-1170-rex-engine-middleman";

export { args_bool_fun, args_number_fun, args_string_fun, parse_args_fun };
export type { ARGS };

// the list endpoints take a limit of 1..100.
export const SHIT_1170_SOCIAL_LIMIT_MIN = 1;
export const SHIT_1170_SOCIAL_LIMIT_MAX = 100;

/**
 * the `--limit` a bin was given, checked against the range the
 * endpoint accepts.
 *
 * a limit outside the range is a usage error, not a 400 from the
 * server.
 */
export function shit_1170_social_limit_fun(
  args: ARGS,
  fallback?: number,
): number | undefined {
  const raw = args_string_fun(args, "limit");
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < SHIT_1170_SOCIAL_LIMIT_MIN ||
    value > SHIT_1170_SOCIAL_LIMIT_MAX
  ) {
    throw new Error(
      `--limit must be an integer ${SHIT_1170_SOCIAL_LIMIT_MIN}..${SHIT_1170_SOCIAL_LIMIT_MAX}`,
    );
  }
  return value;
}

/**
 * the page params every list endpoint takes.
 */
export function shit_1170_social_page_params_fun(args: ARGS): {
  limit?: number;
  cursor?: string;
  viewer?: string;
} {
  return {
    limit: shit_1170_social_limit_fun(args),
    cursor: args_string_fun(args, "cursor"),
    viewer: args_string_fun(args, "viewer"),
  };
}

/**
 * the `--viewer` a bin was given, if any.
 *
 * the viewer is the account the API answers "from": it adds the
 * `liked`, `reposted` and `following` flags to the answer.
 */
export function shit_1170_social_viewer_fun(args: ARGS): string | undefined {
  return args_string_fun(args, "viewer");
}

// ------------------------------------------------------------
// THE POST SHAPE
// ------------------------------------------------------------

export interface SHIT_1170_SOCIAL_POST_SUMMARY {
  key: string;
  id: string;
  accountId: string;
  name: string | null;
  text: string;
  createdAt: number;
  replies: number;
  reposts: number;
  likes: number;
  quotes: number;
  replyTo: string | null;
  root: string | null;
  quote: string | null;
  hashtags: string[];
  mentions: string[];
  media: { src: string; mime: string; alt: string | null }[];
  link: string | null;
  liked: boolean | null;
  reposted: boolean | null;
}

interface SHIT_1170_POST_LIKE {
  key: string;
  id: string;
  author: { account_id: string; name: string | null };
  text: string;
  created_at: number;
  reply_to: { key: string } | null;
  root: string | null;
  quote: { key: string } | null;
  hashtags: string[];
  mentions: string[];
  media: { src: string; mime: string; alt: string | null }[];
  link: { url: string } | null;
  counts: {
    replies: number;
    reposts: number;
    likes: number;
    quotes: number;
  };
  viewer?: { liked: boolean; reposted: boolean };
}

/**
 * one post, in the shape the bins answer with.
 *
 * the bin answers with the counts and the flags an agent actually
 * reads, and leaves the raw object out — a feed of twenty posts is
 * a lot of json nobody reads.
 */
export function shit_1170_social_post_summary_fun(
  post: SHIT_1170_POST_LIKE,
): SHIT_1170_SOCIAL_POST_SUMMARY {
  return {
    key: post.key,
    id: post.id,
    accountId: post.author.account_id,
    name: post.author.name,
    text: post.text,
    createdAt: post.created_at,
    replies: post.counts.replies,
    reposts: post.counts.reposts,
    likes: post.counts.likes,
    quotes: post.counts.quotes,
    replyTo: post.reply_to?.key ?? null,
    root: post.root,
    quote: post.quote?.key ?? null,
    hashtags: post.hashtags ?? [],
    mentions: post.mentions ?? [],
    media: (post.media ?? []).map((item) => ({
      src: item.src,
      mime: item.mime,
      alt: item.alt ?? null,
    })),
    link: post.link?.url ?? null,
    liked: post.viewer?.liked ?? null,
    reposted: post.viewer?.reposted ?? null,
  };
}

/**
 * a page of posts, in the shape the bins answer with.
 */
export function shit_1170_social_posts_page_fun(page: {
  items: { type: string; post: SHIT_1170_POST_LIKE; reposted_by?: unknown }[];
  next_cursor: string | null;
}): { items: SHIT_1170_SOCIAL_POST_SUMMARY[]; nextCursor: string | null } {
  return {
    items: page.items.map((item) => ({
      ...shit_1170_social_post_summary_fun(item.post),
      repostedBy:
        (item.reposted_by as { account_id?: string } | null)?.account_id ?? null,
    })),
    nextCursor: page.next_cursor,
  };
}

/**
 * the timestamp a bin answers with, in the local time zone.
 *
 * the API's times are Unix milliseconds.
 */
export function shit_1170_social_time_fun(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
