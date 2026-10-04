use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GroupDirectory {
    Local {
        directory: String,
    },
    Ssh {
        host: String,
        username: Option<String>,
        port: Option<u16>,
        directory: String,
    },
}

#[derive(Clone, Copy)]
pub enum CommandShell {
    Posix,
    Fish,
    PowerShell,
}

impl CommandShell {
    pub fn quote(self, argument: &str) -> String {
        match self {
            Self::Posix => quote_posix(argument),
            Self::Fish => format!("'{}'", argument.replace('\\', "\\\\").replace('\'', "\\'")),
            Self::PowerShell => format!("'{}'", argument.replace('\'', "''")),
        }
    }
}

impl GroupDirectory {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Local { directory } => {
                validate_directory(directory)?;
                if !self.local_path().is_some_and(|path| path.is_absolute()) {
                    return Err(
                        "Enter an absolute local directory, or a path starting with ~.".into(),
                    );
                }
                if !self.local_path().is_some_and(|path| path.is_dir()) {
                    return Err("The local directory does not exist or is not accessible.".into());
                }
            }
            Self::Ssh {
                host,
                username,
                port,
                directory,
            } => {
                if !valid_connection_field(host, true) {
                    return Err("Enter an SSH hostname, IP address, or configuration alias.".into());
                }
                if username
                    .as_ref()
                    .is_some_and(|name| !valid_connection_field(name, false))
                {
                    return Err("Enter a valid SSH username, or leave it blank.".into());
                }
                if *port == Some(0) {
                    return Err("The SSH port must be between 1 and 65535.".into());
                }
                validate_directory(directory)?;
            }
        }
        Ok(())
    }

    pub fn local_path(&self) -> Option<PathBuf> {
        let Self::Local { directory } = self else {
            return None;
        };
        if directory == "~" || directory.starts_with("~/") || directory.starts_with("~\\") {
            let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
            Some(PathBuf::from(home).join(directory.get(2..).unwrap_or_default()))
        } else {
            Some(PathBuf::from(directory))
        }
    }

    pub fn startup_command(&self, shell: CommandShell) -> Result<Option<String>, String> {
        self.validate()?;
        let Self::Ssh {
            host,
            username,
            port,
            directory,
        } = self
        else {
            return Ok(None);
        };
        let destination = username
            .as_ref()
            .map_or_else(|| host.clone(), |name| format!("{name}@{host}"));
        let path = if directory == "~" {
            "\"$HOME\"".to_string()
        } else if let Some(relative) = directory.strip_prefix("~/") {
            format!("\"$HOME\"/{}", quote_posix(relative))
        } else {
            quote_posix(directory)
        };
        let remote = format!("cd -- {path} && exec \"${{SHELL:-/bin/sh}}\" -l");
        let remote = format!("/bin/sh -c {}", quote_remote_argument(&remote));
        let port = port.map_or_else(String::new, |port| format!(" -p {port}"));
        let prefix = if matches!(shell, CommandShell::PowerShell) {
            "& "
        } else {
            ""
        };
        Ok(Some(format!(
            "{prefix}ssh -t{port} -- {} {}",
            shell.quote(&destination),
            shell.quote(&remote)
        )))
    }
}

fn validate_directory(directory: &str) -> Result<(), String> {
    if directory.trim().is_empty() || directory.chars().any(char::is_control) {
        return Err("Enter a directory without control characters.".into());
    }
    Ok(())
}

fn valid_connection_field(value: &str, host: bool) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_')
                || (host && matches!(character, ':' | '[' | ']'))
        })
}

// The remote login shell parses this argument before /bin/sh receives it.
fn quote_remote_argument(value: &str) -> String {
    let mut quoted = String::from("'");
    for character in value.chars() {
        match character {
            '\'' => quoted.push_str("'\"'\"'"),
            '\\' => quoted.push_str("'\"\\\\\"'"),
            character => quoted.push(character),
        }
    }
    quoted.push('\'');
    quoted
}

pub fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
#[path = "group_directory_tests.rs"]
mod tests;
