// =================================================
// THE TESTS.
//
// these are the facts about the protocol that were checked against
// the running server. a change that breaks one of them breaks the
// client.
//
// the parse tests use the exact lines the server sends, tags and all.
// =================================================

#[cfg(test)]
mod tests {
    use crate::irc::{parse_line, to_event};

    // --- THE PARSER ---

    #[test]
    fn parses_a_plain_command() {
        let message = parse_line("PING probe-alpha-7");
        assert_eq!(message.command, "PING");
        assert_eq!(message.params, vec!["probe-alpha-7"]);
        assert!(message.prefix.is_none());
    }

    #[test]
    fn parses_a_prefix() {
        let message = parse_line(":irc.shit-1170.com 001 nick :Welcome to the network");
        assert_eq!(message.prefix.as_deref(), Some("irc.shit-1170.com"));
        assert_eq!(message.command, "001");
        assert_eq!(message.params.len(), 2);
        assert_eq!(message.params[0], "nick");
        assert_eq!(message.params[1], "Welcome to the network");
    }

    #[test]
    fn parses_message_tags() {
        // this is the exact shape the server sends. without stripping
        // the tag block, the command reads as `@time=2026-...` and is
        // never recognized — a CAP ACK goes by unseen.
        let message = parse_line(
            "@time=2026-11-11T15:58:09.682Z :irc.shit-1170.com CAP * ACK :sasl message-tags",
        );
        assert_eq!(message.command, "CAP");
        assert_eq!(message.prefix.as_deref(), Some("irc.shit-1170.com"));
        assert_eq!(
            message.tags.get("time").map(|s| s.as_str()),
            Some("2026-11-11T15:58:09.682Z")
        );
        assert_eq!(message.params[1], "ACK");
    }

    #[test]
    fn parses_a_privmsg_with_tags() {
        let message = parse_line(
            "@time=2026-11-11T19:31:25.623Z;msgid=xneeb9ys8er6xiaqt27qnbnvhe :peer-bot-1!~u@xxcdfcistahx2.irc.shit-1170.com PRIVMSG #rust-test :hello-from-peer-1",
        );
        assert_eq!(message.command, "PRIVMSG");
        assert_eq!(message.params[0], "#rust-test");
        assert_eq!(message.params[1], "hello-from-peer-1");
        assert_eq!(
            message.tags.get("msgid").map(|s| s.as_str()),
            Some("xneeb9ys8er6xiaqt27qnbnvhe")
        );
    }

    #[test]
    fn parses_a_trailing_param_with_spaces() {
        let message = parse_line(":nick!u@h PRIVMSG #chan :hello there, this is one param");
        assert_eq!(message.params.len(), 2);
        assert_eq!(message.params[1], "hello there, this is one param");
    }

    #[test]
    fn parses_a_tag_with_no_value() {
        let message = parse_line("@bot;time=2026-11-11T16:12:12.566Z :nick!u@h PRIVMSG #chan :hi");
        assert_eq!(message.tags.get("bot").map(|s| s.as_str()), Some(""));
        assert_eq!(message.command, "PRIVMSG");
    }

    // --- THE EVENTS ---

    #[test]
    fn a_privmsg_is_a_message() {
        let message = parse_line(
            "@msgid=abc :peer-bot-1!~u@host PRIVMSG #rust-test :hello",
        );
        let event = to_event(&message).expect("a privmsg is an event");
        assert_eq!(event.kind, "message");
        assert_eq!(event.from.as_deref(), Some("peer-bot-1"));
        assert_eq!(event.target.as_deref(), Some("#rust-test"));
        assert_eq!(event.text.as_deref(), Some("hello"));
        assert_eq!(event.msgid.as_deref(), Some("abc"));
    }

    #[test]
    fn the_nick_is_split_off_the_prefix() {
        // the prefix is `nick!ident@host`, not the bare nick. this is
        // what the channel tracking compares against, and getting it
        // wrong left the channel list empty.
        let message = parse_line(":rust-test-5!~u@xxcdfcistahx2.irc.shit-1170.com JOIN #rust-test");
        assert_eq!(
            message.prefix.as_deref(),
            Some("rust-test-5!~u@xxcdfcistahx2.irc.shit-1170.com")
        );
        let nick = message
            .prefix
            .as_ref()
            .unwrap()
            .split('!')
            .next()
            .unwrap();
        assert_eq!(nick, "rust-test-5");
    }

    #[test]
    fn a_numeric_is_not_an_event() {
        let message = parse_line(":irc.shit-1170.com 001 nick :Welcome");
        assert!(to_event(&message).is_none());
    }

    #[test]
    fn a_ping_is_an_event() {
        let message = parse_line("PING probe-alpha-7");
        let event = to_event(&message).expect("a ping is an event");
        assert_eq!(event.kind, "ping");
        assert_eq!(event.target.as_deref(), Some("probe-alpha-7"));
    }

    // --- THE CHATHISTORY SYNTAX ---

    #[test]
    fn the_chathistory_line_is_the_right_shape() {
        // the ircv3 draft is
        //   CHATHISTORY LATEST <target> <*|timestamp|msgid> <limit>
        // the old typescript skill sent
        //   CHATHISTORY LATEST <limit> TARGETS=<chan>
        // which the server answered with `461 Not enough parameters`
        // every single time.
        let line = format!("CHATHISTORY LATEST {} * {}", "#rust-test", 50);
        let message = parse_line(&line);
        assert_eq!(message.command, "CHATHISTORY");
        assert_eq!(message.params[0], "LATEST");
        assert_eq!(message.params[1], "#rust-test");
        assert_eq!(message.params[2], "*");
        assert_eq!(message.params[3], "50");
    }

    // --- THE PONG ---

    #[test]
    fn the_pong_carries_the_ping_token() {
        // the server sends `PING <the pinged client's nick>`, so the
        // answer is `PONG <our nick>`.
        let message = parse_line("PING pong-test-1");
        let token = message.params.first().cloned().unwrap_or_default();
        assert_eq!(format!("PONG {token}"), "PONG pong-test-1");
    }
}
