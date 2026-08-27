use portable_pty::CommandBuilder;

/// Shells we know how to instrument. Anything else is launched untouched.
pub fn supports_integration(shell_path: &str) -> bool {
    matches!(shell_name(shell_path).as_str(), "bash" | "zsh")
}

fn shell_name(shell_path: &str) -> String {
    std::path::Path::new(shell_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Bash shell integration.
///
/// Without this nothing ever emits OSC 133, so the UI never learns when a
/// command started or finished: blocks stay "running" forever and never get an
/// exit code, a duration or a pass/fail rail. OSC 7 is included so `cd` moves
/// the status plate.
pub fn bash_integration_script() -> String {
    String::from(
        r#"# Doom Term shell integration. Generated per session; safe to delete.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

__doom_term_precmd() {
  local ec=$?
  printf '\033]133;D;%s\007' "$ec"
  printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"
}

if ((BASH_VERSINFO[0] >= 5)) && [[ ${PROMPT_COMMAND@a} == *a* ]]; then
  PROMPT_COMMAND+=(__doom_term_precmd)
else
  case "${PROMPT_COMMAND:-}" in
    *__doom_term_precmd*) ;;
    *) PROMPT_COMMAND="__doom_term_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
  esac
fi

# PS0 is expanded after the command is read but before it runs.
PS0='\e]133;C\a'"${PS0:-}"
case "$PS1" in
  *'133;A'*) ;;
  *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
esac
"#,
    )
}

/// Zsh equivalent. ZDOTDIR points here, so we hand control straight back to the
/// user's own dotfiles before adding the hooks.
pub fn zsh_integration_script() -> String {
    String::from(
        r#"# Doom Term shell integration. Generated per session; safe to delete.
if [ -n "$DOOM_TERM_USER_ZDOTDIR" ]; then
  export ZDOTDIR="$DOOM_TERM_USER_ZDOTDIR"
else
  unset ZDOTDIR
fi
[ -f "${ZDOTDIR:-$HOME}/.zshrc" ] && source "${ZDOTDIR:-$HOME}/.zshrc"

__doom_term_precmd() {
  local ec=$?
  print -n "\033]133;D;${ec}\007"
  print -n "\033]7;file://${HOST}${PWD}\033\\"
  print -n "\033]133;A\007"
}
__doom_term_preexec() { print -n "\033]133;C\007" }

typeset -ag precmd_functions preexec_functions
precmd_functions+=(__doom_term_precmd)
preexec_functions+=(__doom_term_preexec)
"#,
    )
}

/// Write an integration script somewhere only this user can reach it. A shell
/// sources this file, so a world-writable location would be an execution hole.
fn write_integration_file(name: &str, body: &str) -> Option<std::path::PathBuf> {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("doom-term");
    std::fs::create_dir_all(&dir).ok()?;

    let path = dir.join(name);
    std::fs::write(&path, body).ok()?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Some(path)
}

/// Add shell integration to a command, if we understand the shell and the user
/// has not opted out with DOOM_TERM_NO_SHELL_INTEGRATION.
pub fn apply_shell_integration(cmd: &mut CommandBuilder, shell: &str) {
    if std::env::var("DOOM_TERM_NO_SHELL_INTEGRATION").is_ok() {
        return;
    }
    match shell_name(shell).as_str() {
        "bash" => {
            if let Some(path) = write_integration_file("bash-integration.sh", &bash_integration_script())
            {
                cmd.arg("--rcfile");
                cmd.arg(path);
                cmd.arg("-i");
            }
        }
        "zsh" => {
            if let Ok(existing) = std::env::var("ZDOTDIR") {
                cmd.env("DOOM_TERM_USER_ZDOTDIR", existing);
            }
            if let Some(path) = write_integration_file(".zshrc", &zsh_integration_script()) {
                if let Some(dir) = path.parent() {
                    cmd.env("ZDOTDIR", dir);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bash_integration_emits_every_osc_133_boundary() {
        let script = bash_integration_script();
        assert!(script.contains("133;A"), "prompt start");
        assert!(script.contains("133;B"), "command start");
        assert!(script.contains("133;C"), "execution start");
        assert!(script.contains("133;D"), "execution end with exit code");
    }

    #[test]
    fn bash_integration_keeps_the_users_own_config() {
        let script = bash_integration_script();
        assert!(script.contains(".bashrc"), "must source the user's bashrc first");
    }

    #[test]
    fn bash_integration_reports_the_working_directory() {
        let script = bash_integration_script();
        assert!(script.contains("]7;file://"), "must emit OSC 7 so cd is visible");
    }

    #[test]
    fn integration_is_only_injected_for_shells_it_understands() {
        assert!(supports_integration("/bin/bash"));
        assert!(supports_integration("/usr/bin/zsh"));
        assert!(!supports_integration("/usr/bin/fish"));
        assert!(!supports_integration("/bin/sh"));
    }
}
