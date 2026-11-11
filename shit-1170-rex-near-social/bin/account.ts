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
  shit_1170_social_viewer_fun,
} from "../src/bin_stuff";
import {
  shit_1170_social_account_fun,
  shit_1170_social_account_posts_fun,
  shit_1170_social_account_replies_fun,
} from "../src/index";

// read an account.
//
// --- THE PROFILE ---
// `--profile` answers with the account's profile: its name, its bio,
// its avatar, its banner, its links and its counts.
//
// an account that has never posted answers with an EMPTY profile and
// `hasProfile: false`. that is not an error — the profile comes back,
// it just has nothing in it. a syntactically valid account id always
// answers.
//
// --- THE POSTS ---
// `--posts` answers with the account's posts and reposts, newest
// first. no replies — `--with-replies` asks for those instead.
//
// this is a READ. nothing here changes anything.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "posts", "profile", "with-replies"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "account <account_id> [--profile] [--posts] [--with-replies]",
        "account <account_id> [--viewer <account_id>] [--limit 20] [--cursor <opaque>]",
        "--profile reads the profile, --posts reads the posts and reposts. both by default.",
      ],
    });
    return;
  }

  const account = args_string_fun(args, "account") ?? args.positional[0];
  if (!account) {
    throw new Error("an account id is required");
  }

  const viewer = shit_1170_social_viewer_fun(args);
  const wantProfile = args_bool_fun(args, "profile");
  const wantPosts = args_bool_fun(args, "posts");
  const wantReplies = args_bool_fun(args, "with-replies");

  // with neither flag, the bin reads both.
  const readProfile = wantProfile || (!wantPosts && !wantReplies);
  const readPosts = wantPosts || wantReplies || (!wantProfile && !wantPosts && !wantReplies);

  const result: Record<string, unknown> = {
    ok: true,
    accountId: account,
    viewer: viewer ?? null,
  };

  if (readProfile) {
    const profile = await shit_1170_social_account_fun(account, viewer);
    result.profile = {
      hasProfile: profile.has_profile,
      name: profile.name,
      about: profile.about,
      location: profile.location,
      avatarUrl: profile.avatar_url,
      bannerUrl: profile.banner_url,
      links: profile.links,
      counts: profile.counts,
      joinedAt: profile.joined_at,
      following: profile.viewer?.following ?? null,
      followedBy: profile.viewer?.followed_by ?? null,
    };
  }

  if (readPosts) {
    const params = shit_1170_social_page_params_fun(args);
    const page = wantReplies
      ? await shit_1170_social_account_replies_fun(account, params)
      : await shit_1170_social_account_posts_fun(account, params);
    result.posts = shit_1170_social_posts_page_fun(page);
  }

  print_json_fun(result);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
