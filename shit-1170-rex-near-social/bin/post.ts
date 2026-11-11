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
  shit_1170_social_post_fun,
  shit_1170_social_post_likes_fun,
  shit_1170_social_post_preview_fun,
  shit_1170_social_post_quotes_fun,
  shit_1170_social_post_replies_fun,
  shit_1170_social_post_reposts_fun,
  shit_1170_social_posts_batch_fun,
} from "../src/index";

// read a post.
//
// --- THE THREAD ---
// a post is named by its author and its id: `alice.near/1759140000000`.
// the answer carries the post AND the chain of ancestors it replies
// to, so a reply arrives with the conversation above it.
//
// `parentMissing: true` means the post it replies to is gone — it was
// deleted, or the indexer never saw it. the reply itself is fine.
//
// --- THE OTHER READS ---
// --replies   the replies to the post
// --quotes    the posts that quote it
// --likes     the accounts that liked it
// --reposts   the accounts that reposted it
// --preview   the link preview for the post's url
//
// --- BATCH ---
// --batch takes a comma-separated list of `account_id/post_id` and
// answers with every post at once. up to one hundred.
//
// this is a READ. nothing here changes anything.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: [
      "help",
      "replies",
      "quotes",
      "likes",
      "reposts",
      "preview",
      "batch",
    ],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "post <account_id>/<post_id> [--replies] [--quotes] [--likes] [--reposts] [--preview]",
        "post --batch <account_id/post_id,account_id/post_id,...>",
        "post <account_id>/<post_id> [--viewer <account_id>] [--limit 20] [--cursor <opaque>]",
      ],
    });
    return;
  }

  // --batch takes a list of keys, not one post.
  if (args_bool_fun(args, "batch")) {
    const raw = args_string_fun(args, "batch");
    if (!raw) throw new Error("--batch needs a comma-separated list of account_id/post_id");
    const keys = raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      throw new Error("--batch needs a comma-separated list of account_id/post_id");
    }
    const page = await shit_1170_social_posts_batch_fun(
      keys,
      shit_1170_social_viewer_fun(args),
    );
    print_json_fun({
      ok: true,
      batch: keys,
      posts: page.items.map((post) => post?.key ?? null),
      items: page.items,
    });
    return;
  }

  const raw = args_string_fun(args, "post") ?? args.positional[0];
  if (!raw) {
    throw new Error("a post is required, as account_id/post_id");
  }
  const parts = raw.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `"${raw}" is not a post reference. a post is account_id/post_id, e.g. alice.near/1759140000000`,
    );
  }
  const accountId = parts[0] as string;
  const postId = parts[1] as string;
  const viewer = shit_1170_social_viewer_fun(args);
  const params = shit_1170_social_page_params_fun(args);

  const result: Record<string, unknown> = {
    ok: true,
    post: `${accountId}/${postId}`,
    viewer: viewer ?? null,
  };

  const thread = await shit_1170_social_post_fun(accountId, postId, viewer);
  result.post_data = {
    key: thread.post.key,
    id: thread.post.id,
    accountId: thread.post.author.account_id,
    name: thread.post.author.name,
    text: thread.post.text,
    createdAt: thread.post.created_at,
    editedAt: thread.post.edited_at,
    counts: thread.post.counts,
    replyTo: thread.post.reply_to?.key ?? null,
    root: thread.post.root,
    quote: thread.post.quote?.key ?? null,
    hashtags: thread.post.hashtags,
    mentions: thread.post.mentions,
    media: thread.post.media,
    link: thread.post.link,
    liked: thread.post.viewer?.liked ?? null,
    reposted: thread.post.viewer?.reposted ?? null,
  };
  result.ancestors = thread.ancestors.map((ancestor) => ({
    key: ancestor.key,
    id: ancestor.id,
    accountId: ancestor.author.account_id,
    text: ancestor.text,
    createdAt: ancestor.created_at,
  }));
  result.parentMissing = thread.parent_missing;

  if (args_bool_fun(args, "replies")) {
    result.replies = shit_1170_social_posts_page_fun(
      await shit_1170_social_post_replies_fun(accountId, postId, params),
    );
  }
  if (args_bool_fun(args, "quotes")) {
    result.quotes = shit_1170_social_posts_page_fun(
      await shit_1170_social_post_quotes_fun(accountId, postId, params),
    );
  }
  if (args_bool_fun(args, "likes")) {
    const page = await shit_1170_social_post_likes_fun(accountId, postId, params);
    result.likes = {
      items: page.items.map((card) => ({
        accountId: card.account_id,
        name: card.name,
        following: card.viewer?.following ?? null,
      })),
      nextCursor: page.next_cursor,
    };
  }
  if (args_bool_fun(args, "reposts")) {
    const page = await shit_1170_social_post_reposts_fun(accountId, postId, params);
    result.reposts = {
      items: page.items.map((card) => ({
        accountId: card.account_id,
        name: card.name,
        following: card.viewer?.following ?? null,
      })),
      nextCursor: page.next_cursor,
    };
  }
  if (args_bool_fun(args, "preview")) {
    const preview = await shit_1170_social_post_preview_fun(accountId, postId);
    result.preview = preview;
  }

  print_json_fun(result);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
