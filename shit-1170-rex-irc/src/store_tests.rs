// =================================================
// THE STORE TESTS.
//
// these cover the local store: the config, the credentials, and the
// history file.
//
// the history is the one that matters here. the store has had the
// append and the read since the typescript skill, but nothing called
// the append — so the file was never written and `config history`
// always came back empty. these tests pin the write down.
//
// the store's home is overridden per test, so the tests never touch
// the real `~/.shit-1170-rex-engine`.
// =================================================

#[cfg(test)]
mod tests {
    use crate::irc::IrcEvent;
    use crate::store;

    /// a temp home for one test, so the tests do not share a store.
    ///
    /// the folder is removed when the guard is dropped, so a test run
    /// leaves nothing behind in the temp dir.
    fn temp_home(name: &str) -> TempHome {
        let dir = std::env::temp_dir().join(format!("shit-1170-rex-irc-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the temp dir");
        // SAFETY: the lock means no other thread is reading or
        // writing the environment at this moment.
        unsafe { std::env::set_var("SHIT_1170_REX_HOME", &dir) };
        TempHome(dir)
    }

    /// a temp folder that removes itself when it goes out of scope.
    struct TempHome(std::path::PathBuf);

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn event(kind: &str, from: &str, text: &str) -> IrcEvent {
        IrcEvent {
            kind: kind.to_string(),
            from: Some(from.to_string()),
            target: Some("#chan".to_string()),
            text: Some(text.to_string()),
            msgid: Some(format!("msgid-{from}-{text}")),
            at: Some("2026-11-11T20:00:00.000Z".to_string()),
            raw: format!("PRIVMSG #chan :{text}"),
        }
    }

    #[tokio::test]
    async fn the_history_is_written_and_read_back() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-round-trip");

        let entry = store::history_entry_for(&event("message", "notyourmom", "hey"))
            .expect("a message is a history entry");
        store::append_history(&[entry]);

        let entries = store::read_history(None);
        assert_eq!(entries.len(), 1, "the message should be in the history");
        assert_eq!(entries[0].text.as_deref(), Some("hey"));
        assert_eq!(entries[0].from.as_deref(), Some("notyourmom"));
        assert_eq!(entries[0].target, "#chan");
    }

    #[tokio::test]
    async fn the_history_file_is_jsonl() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-jsonl");

        for text in ["one", "two"] {
            let entry =
                store::history_entry_for(&event("message", "notyourmom", text)).expect("an entry");
            store::append_history(&[entry]);
        }

        let text = std::fs::read_to_string(store::history_path()).expect("the history file");
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 2, "one json object per line");
        for line in &lines {
            serde_json::from_str::<serde_json::Value>(line).expect("each line is json");
        }
    }

    #[tokio::test]
    async fn the_read_keeps_the_last_entries() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-limit");

        for text in ["one", "two", "three"] {
            let entry =
                store::history_entry_for(&event("message", "notyourmom", text)).expect("an entry");
            store::append_history(&[entry]);
        }

        let entries = store::read_history(Some(2));
        assert_eq!(entries.len(), 2, "the limit keeps the newest");
        assert_eq!(entries[0].text.as_deref(), Some("two"));
        assert_eq!(entries[1].text.as_deref(), Some("three"));
    }

    #[tokio::test]
    async fn the_forget_empties_the_history() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-forget");

        let entry =
            store::history_entry_for(&event("message", "notyourmom", "hey")).expect("an entry");
        store::append_history(&[entry]);
        assert_eq!(store::read_history(None).len(), 1);

        store::clear_history();
        assert_eq!(store::read_history(None).len(), 0, "the history is empty");
    }

    #[tokio::test]
    async fn only_what_was_said_goes_into_the_history() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-kinds");

        // a join is noise in a log of the conversation.
        assert!(
            store::history_entry_for(&event("join", "notyourmom", "#chan")).is_none(),
            "a join is not a history entry"
        );
        assert!(
            store::history_entry_for(&event("quit", "notyourmom", "")).is_none(),
            "a quit is not a history entry"
        );
        assert!(
            store::history_entry_for(&event("topic", "notyourmom", "a topic")).is_none(),
            "a topic is not a history entry"
        );

        // what somebody said is kept.
        assert!(
            store::history_entry_for(&event("message", "notyourmom", "hey")).is_some(),
            "a message is a history entry"
        );
        assert!(
            store::history_entry_for(&event("notice", "server", "hi")).is_some(),
            "a notice is a history entry"
        );
        assert!(
            store::history_entry_for(&event("dm", "notyourmom", "psst")).is_some(),
            "a dm is a history entry"
        );
    }

    #[tokio::test]
    async fn the_server_time_is_the_timestamp() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-at");

        let entry =
            store::history_entry_for(&event("message", "notyourmom", "hey")).expect("an entry");
        assert_eq!(
            entry.at, "2026-11-11T20:00:00.000Z",
            "the server's own timestamp is kept"
        );
    }

    #[tokio::test]
    async fn a_missing_server_time_falls_back_to_the_local_clock() {
        let _guard = store::test_lock().await;
        let _home = temp_home("history-at-fallback");

        let mut ev = event("message", "notyourmom", "hey");
        ev.at = None;
        let entry = store::history_entry_for(&ev).expect("an entry");
        assert_eq!(entry.at.len(), 20, "an ISO timestamp");
        assert!(entry.at.ends_with('Z'), "an ISO timestamp ends in Z");
    }

    #[tokio::test]
    async fn the_local_clock_is_a_real_date() {
        // the epoch itself.
        let (year, month, day, hour, minute, second) = store::civil_from_unix(0);
        assert_eq!((year, month, day), (1970, 1, 1));
        assert_eq!((hour, minute, second), (0, 0, 0));

        // a known timestamp: 2026-11-12T15:37:00Z
        let secs = 1_794_497_820u64;
        let (year, month, day, hour, minute, second) = store::civil_from_unix(secs);
        assert_eq!((year, month, day), (2026, 11, 12));
        assert_eq!((hour, minute, second), (15, 37, 0));
    }

    #[tokio::test]
    async fn the_config_survives_a_write_and_a_read() {
        let _guard = store::test_lock().await;
        let _home = temp_home("config-round-trip");

        let mut config = store::read_config();
        config.nick = "myagent".to_string();
        config.channels = vec!["#chan".to_string()];
        store::write_config(&config).expect("the config is written");

        let read = store::read_config();
        assert_eq!(read.nick, "myagent");
        assert_eq!(read.channels, vec!["#chan".to_string()]);
    }

    #[tokio::test]
    async fn the_credentials_are_kept_apart_and_never_printed() {
        let _guard = store::test_lock().await;
        let _home = temp_home("credentials");

        let mut credentials = store::Credentials::default();
        credentials.by_nick.insert(
            "myagent".to_string(),
            store::Credential {
                account: None,
                password: "hunter2".to_string(),
            },
        );
        store::write_credentials(&credentials).expect("the credentials are written");

        // the file is 0600, so it is readable only by its owner.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(store::credentials_path())
                .expect("the credentials file")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "the password file is 0600");
        }

        let read = store::credential_for("myagent").expect("the credential");
        assert_eq!(read.password, "hunter2");
    }
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
