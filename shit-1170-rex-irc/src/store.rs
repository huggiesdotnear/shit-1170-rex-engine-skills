// =================================================
// THE LOCAL STORE.
//
// where this skill keeps what it remembers between runs.
//
// the store is under ${HOME}/.shit-1170-rex-engine/ — the same place
// the other skills keep theirs, so there is one folder per machine and
// not one per skill.
//
// this skill's folder is `irc/`:
//
//   ${HOME}/.shit-1170-rex-engine/irc/
//     config.json       the default server, nick and channels
//     credentials.json  the account password, mode 0600
//     history.jsonl     the messages seen, one per line
//
// --- WHY THE PASSWORD IS IN A FILE AND NOT IN THE CONFIG ---
// the config is the safe file. it can be read, copied and committed.
// the credentials are not. they get mode 0600, and they are never
// printed by any bin.
//
// --- WHY A HISTORY FILE ---
// a client that read a channel and then acted on it wants to be able
// to look at what it read again. the ircd keeps messages in memory
// only, and it forgets everything when it restarts, so the client
// keeps its own copy.
// =================================================

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// the folder name under the home dir.
pub const HOME_DIR_NAME: &str = ".shit-1170-rex-engine";

/// the home folder the store lives in.
///
/// `SHIT_1170_REX_HOME` overrides it, which is what the other skills
/// do and what makes the store testable.
pub fn home_dir() -> PathBuf {
    if let Ok(from_env) = std::env::var("SHIT_1170_REX_HOME") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(HOME_DIR_NAME)
}

/// the irc folder inside the store.
pub fn irc_dir() -> PathBuf {
    home_dir().join("irc")
}

/// the config file. it holds no secrets.
pub fn config_path() -> PathBuf {
    irc_dir().join("config.json")
}

/// the credentials file. it holds the account password.
pub fn credentials_path() -> PathBuf {
    irc_dir().join("credentials.json")
}

/// the history file, one json object per line.
pub fn history_path() -> PathBuf {
    irc_dir().join("history.jsonl")
}

/// what the config file holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrcConfig {
    /// the hostname to talk to.
    pub server: String,
    /// the port.
    pub port: u16,
    /// the nickname to register with.
    pub nick: String,
    /// the realname to register with.
    pub realname: String,
    /// the channels to join on connect.
    pub channels: Vec<String>,
    /// use tls (wss).
    pub tls: bool,
    /// set the +B bot mode on connect.
    ///
    /// this is ON by default. the client is a program, and the `+B`
    /// mode is how it says so — the server tags everything the client
    /// sends with the ircv3 `bot` tag, so other clients can tell a
    /// bot from a person.
    ///
    /// a client that says it is a bot when it is not would be lying to
    /// everyone else in the channel, so the default is the honest one.
    pub bot: bool,
}

impl Default for IrcConfig {
    fn default() -> Self {
        IrcConfig {
            server: crate::irc::DEFAULT_SERVER.to_string(),
            port: crate::irc::DEFAULT_PORT,
            nick: crate::irc::DEFAULT_NICK.to_string(),
            realname: "sleet agent".to_string(),
            channels: vec!["#shit-1170".to_string()],
            tls: true,
            bot: true,
        }
    }
}

/// read the config, or the defaults if there is none.
///
/// a config file that is not valid json is an error, not a silent
/// fallback: a typo in the config that quietly reverts to the defaults
/// would connect to the wrong place.
pub fn read_config() -> IrcConfig {
    let path = config_path();
    if !path.exists() {
        return IrcConfig::default();
    }
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) => {
            tracing::warn!(%err, path = %path.display(), "could not read the config");
            return IrcConfig::default();
        }
    };
    match serde_json::from_str::<IrcConfig>(&text) {
        Ok(config) => config,
        Err(err) => {
            tracing::error!(%err, path = %path.display(), "the config is not valid json");
            IrcConfig::default()
        }
    }
}

/// write the config.
pub fn write_config(config: &IrcConfig) -> std::io::Result<()> {
    fs::create_dir_all(irc_dir())?;
    let text = serde_json::to_string_pretty(config).unwrap_or_default();
    fs::write(config_path(), format!("{text}\n"))
}

/// the credentials, keyed by nick.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Credentials {
    #[serde(flatten)]
    pub by_nick: std::collections::HashMap<String, Credential>,
}

/// one nick's credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    /// the account name, when it is not the nick.
    #[serde(default)]
    pub account: Option<String>,
    /// the account password.
    pub password: String,
}

/// read the credentials file.
pub fn read_credentials() -> Credentials {
    let path = credentials_path();
    if !path.exists() {
        return Credentials::default();
    }
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Credentials>(&text).unwrap_or_default(),
        Err(_) => Credentials::default(),
    }
}

/// write the credentials file, with mode 0600.
///
/// the file holds a password, so it is made readable only by its
/// owner. the chmod is done after the write, because the mode a file
/// is created with is decided by the umask, not by us.
pub fn write_credentials(credentials: &Credentials) -> std::io::Result<()> {
    fs::create_dir_all(irc_dir())?;
    let path = credentials_path();
    let text = serde_json::to_string_pretty(credentials).unwrap_or_default();
    fs::write(&path, format!("{text}\n"))?;
    set_mode_600(&path);
    Ok(())
}

/// set a file's mode to 0600, ignoring the platforms that do not
/// support it.
pub fn set_mode_600(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// the credentials for one nick.
pub fn credential_for(nick: &str) -> Option<Credential> {
    read_credentials().by_nick.get(nick).cloned()
}

/// one remembered message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    /// when it was seen, as an ISO timestamp.
    pub at: String,
    /// the channel or nick it was in.
    pub target: String,
    /// who said it.
    pub from: Option<String>,
    /// what they said.
    pub text: Option<String>,
    /// the ircv3 msgid, when the server sent one.
    #[serde(default)]
    pub msgid: Option<String>,
}

/// append messages to the history file.
///
/// the file is a JSONL — one json object per line — so appending does
/// not rewrite the whole file, and a reader can stream it.
pub fn append_history(entries: &[HistoryEntry]) {
    if entries.is_empty() {
        return;
    }
    if fs::create_dir_all(irc_dir()).is_err() {
        return;
    }
    let mut file = match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(history_path())
    {
        Ok(file) => file,
        Err(err) => {
            tracing::warn!(%err, "could not open the history file");
            return;
        }
    };
    for entry in entries {
        if let Ok(line) = serde_json::to_string(entry) {
            let _ = writeln!(file, "{line}");
        }
    }
}

/// read the history, newest last.
///
/// `limit` keeps the LAST n entries, which is what a caller asking
/// "what did i just see" wants.
pub fn read_history(limit: Option<usize>) -> Vec<HistoryEntry> {
    let path = history_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let mut entries: Vec<HistoryEntry> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
            entries.push(entry);
        }
    }
    if let Some(limit) = limit
        && limit > 0 && entries.len() > limit {
            return entries.split_off(entries.len() - limit);
        }
    entries
}

/// forget the history.
pub fn clear_history() {
    let path = history_path();
    if path.exists() {
        let _ = fs::write(path, "");
    }
}

/// a short random id, unique per call.
///
/// it is used to tell one daemon from another. two daemons can end
/// up fighting over the same port, and the client commands then talk
/// to the wrong one without noticing — the worst kind of failure,
/// because it looks like it worked.
pub fn random_id() -> String {
    // the time in nanoseconds, mixed with the process id. it does not
    // have to be cryptographic — it only has to be different between
    // two daemons on one machine.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{:x}", nanos, std::process::id())
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
