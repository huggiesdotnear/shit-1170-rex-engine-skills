#!/usr/bin/env bun
import {
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  shit_1170_social_page_params_fun,
  shit_1170_social_posts_page_fun,
} from "../src/bin_stuff";
import {
  shit_1170_social_hashtags_trending_fun,
  shit_1170_social_notifications_fun,
  shit_1170_social_notifications_count_fun,
  shit_1170_social_search_accounts_fun,
  shit_1170_social_search_posts_fun,
  shit_1170_social_status_fun,
  shit_1170_social_suggestions_fun,
} from "../src/index";

// the rest of the reads: search, notifications, suggestions, trending
// hashtags, and the indexer's own status.
//
// --- WHAT EACH ONE READS ---
//   --search <q>    the posts whose text contains the query
//   --accounts <q>  the accounts matching the query
//   --notifications <account_id>   the account's notifications
//   --count <account_id>           how many notifications it has
//   --suggestions                  the accounts to follow
//   --trending                     the top hashtags over the last day
//   --status                       how far the indexer has got
//
// --- THE STATUS ---
// `--status` is worth knowing before anything else: it says how far
// the indexer has got on the chain, and how many accounts, posts,
// likes and follows it has seen. `lagMs` is how far behind the
// chain it is.
//
// this is a READ. nothing here changes anything.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: [
      "help",
      "count",
      "status",
      "suggestions",
      "trending",
    ],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "search --search <query> [--limit 20] [--cursor <opaque>] [--viewer <account_id>]",
        "search --accounts <query> [--limit 20] [--cursor <opaque>]",
        "search --notifications <account_id> [--limit 20] [--cursor <opaque>]",
        "search --count <account_id> [--since <epoch_millis>]",
        "search --suggestions [--limit 20] [--viewer <account_id>]",
        "search --trending",
        "search --status",
      ],
    });
    return;
  }

  const params = shit_1170_social_page_params_fun(args);
  const result: Record<string, unknown> = { ok: true };

  const search = args_string_fun(args, "search");
  const accounts = args_string_fun(args, "accounts");
  const notifications = args_string_fun(args, "notifications");
  const count = args_string_fun(args, "count");

  if (search) {
    result.search = shit_1170_social_posts_page_fun(
      await shit_1170_social_search_posts_fun(search, params),
    );
  }

  if (accounts) {
    const page = await shit_1170_social_search_accounts_fun(accounts, params);
    result.accounts = {
      items: page.items.map((card) => ({
        accountId: card.account_id,
        name: card.name,
        avatarUrl: card.avatar_url,
        about: card.about,
        followers: card.followers,
      })),
      nextCursor: page.next_cursor,
    };
  }

  if (notifications) {
    const page = await shit_1170_social_notifications_fun(notifications, params);
    result.notifications = {
      items: page.items.map((notification) => ({
        kind: notification.kind,
        actorCount: notification.actor_count,
        actors: notification.actors.map((actor) => ({
          accountId: actor.account_id,
          name: actor.name,
        })),
        postKey: notification.post?.key ?? null,
        postText: notification.post?.text ?? null,
        createdAt: notification.created_at,
      })),
      nextCursor: page.next_cursor,
    };
  }

  if (count) {
    const sinceRaw = args_string_fun(args, "since");
    const since = sinceRaw === undefined ? undefined : Number(sinceRaw);
    if (since !== undefined && !Number.isFinite(since)) {
      throw new Error("--since must be a number of milliseconds since the epoch");
    }
    result.count = await shit_1170_social_notifications_count_fun(count, since);
  }

  if (args_bool_fun(args, "suggestions")) {
    const page = await shit_1170_social_suggestions_fun(params);
    result.suggestions = {
      items: page.items.map((card) => ({
        accountId: card.account_id,
        name: card.name,
        avatarUrl: card.avatar_url,
        about: card.about,
        followers: card.followers,
      })),
      nextCursor: page.next_cursor,
    };
  }

  if (args_bool_fun(args, "trending")) {
    const page = await shit_1170_social_hashtags_trending_fun();
    result.trending = {
      items: page.items.map((hashtag) => ({
        tag: hashtag.tag,
        count: hashtag.count,
      })),
    };
  }

  if (args_bool_fun(args, "status")) {
    const status = await shit_1170_social_status_fun();
    result.status = {
      standard: status.standard,
      chainId: status.chain_id,
      socialAccountId: status.social_account_id,
      lastBlockHeight: status.last_block_height,
      lagMs: status.lag_ms,
      counts: status.counts,
    };
  }

  if (
    !search &&
    !accounts &&
    !notifications &&
    !count &&
    !args_bool_fun(args, "suggestions") &&
    !args_bool_fun(args, "trending") &&
    !args_bool_fun(args, "status")
  ) {
    throw new Error(
      "nothing to read. pass --search, --accounts, --notifications, --count, --suggestions, --trending or --status",
    );
  }

  print_json_fun(result);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
