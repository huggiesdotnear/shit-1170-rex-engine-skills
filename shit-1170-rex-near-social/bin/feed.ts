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
  shit_1170_social_feed_following_fun,
  shit_1170_social_feed_for_you_fun,
  shit_1170_social_feed_global_fun,
  shit_1170_social_hashtag_feed_fun,
} from "../src/index";

// read a feed.
//
// --- THE FOUR FEEDS ---
//   for_you    trending, mixed with the accounts the viewer follows
//   global     every top-level post, newest first
//   following  the account's own home feed — who it follows, and itself
//   hashtag    the posts with one hashtag
//
// --- THE PAGE ---
// every list endpoint answers with `{ items, next_cursor }`. the
// cursor is OPAQUE — hand it back exactly as it came. `--cursor` takes
// it, and the answer's `nextCursor` is the next one.
//
// --- THE VIEWER ---
// `--viewer` answers "as this account": it adds the `liked`,
// `reposted` and `following` flags to every item.
//
// this is a READ. nothing here changes anything.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "feed --feed for_you|global|following|hashtag [--account <id>] [--tag <tag>]",
        "feed --feed global [--limit 20] [--cursor <opaque>] [--viewer <account_id>]",
        "the feeds are: for_you, global, following, hashtag",
      ],
    });
    return;
  }

  const feed = (args_string_fun(args, "feed") ?? "global").trim();
  const params = shit_1170_social_page_params_fun(args);

  let page;
  switch (feed) {
    case "for_you":
    case "for-you":
      page = await shit_1170_social_feed_for_you_fun(params);
      break;
    case "global":
      page = await shit_1170_social_feed_global_fun(params);
      break;
    case "following": {
      const account = args_string_fun(args, "account");
      if (!account) {
        throw new Error("--account <account_id> is required for the following feed");
      }
      page = await shit_1170_social_feed_following_fun(account, params);
      break;
    }
    case "hashtag": {
      const tag = args_string_fun(args, "tag");
      if (!tag) {
        throw new Error("--tag <tag> is required for the hashtag feed");
      }
      page = await shit_1170_social_hashtag_feed_fun(tag, params);
      break;
    }
    default:
      throw new Error(
        `"${feed}" is not a feed. the feeds are: for_you, global, following, hashtag`,
      );
  }

  print_json_fun({
    ok: true,
    feed,
    viewer: params.viewer ?? null,
    ...shit_1170_social_posts_page_fun(page),
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
