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
///
/// Every sequence goes through `__doom_term_osc`, because inside tmux a bare
/// OSC never reaches us — tmux consumes 133 and keeps 7 for itself. The DCS
/// wrapper is the documented way out and requires `allow-passthrough on`, which
/// the substrate config sets. One ESC per sequence keeps the wrapper a fixed
/// prefix rather than an escaping pass, which is why OSC 7 ends in BEL here.
pub fn bash_integration_script() -> String {
    String::from(
        r#"# Doom Term shell integration. Generated per session; safe to delete.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

__doom_term_osc() {
  if [ -n "$TMUX" ]; then
    printf '\033Ptmux;\033%s\033\\' "$1"
  else
    printf '%s' "$1"
  fi
}

__doom_term_precmd() {
  local ec=$?
  __doom_term_osc "$(printf '\033]133;D;%s\007' "$ec")"
  __doom_term_osc "$(printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD")"
}

if ((BASH_VERSINFO[0] >= 5)) && [[ ${PROMPT_COMMAND@a} == *a* ]]; then
  PROMPT_COMMAND+=(__doom_term_precmd)
else
  case "${PROMPT_COMMAND:-}" in
    *__doom_term_precmd*) ;;
    *) PROMPT_COMMAND="__doom_term_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
  esac
fi

# PS0 is expanded after the command is read but before it runs. It cannot call
# a function that writes to stdout without the output landing in the prompt, so
# the wrapper is inlined by value at rc time instead.
if [ -n "$TMUX" ]; then
  __doom_term_ps0=$'\ePtmux;\e\e]133;C\a\e\\'
  __doom_term_a=$'\ePtmux;\e\e]133;A\a\e\\'
  __doom_term_b=$'\ePtmux;\e\e]133;B\a\e\\'
else
  __doom_term_ps0=$'\e]133;C\a'
  __doom_term_a=$'\e]133;A\a'
  __doom_term_b=$'\e]133;B\a'
fi
PS0="${__doom_term_ps0}${PS0:-}"
case "$PS1" in
  *'133;A'*) ;;
  *) PS1="\[${__doom_term_a}\]${PS1}\[${__doom_term_b}\]" ;;
esac
"#,
    )
}

/// Zsh equivalent. ZDOTDIR points here, so we hand control straight back to the
/// user's own dotfiles before adding the hooks. Same tmux wrapping as bash: see
/// `bash_integration_script` for why it exists.
pub fn zsh_integration_script() -> String {
    String::from(
        r#"# Doom Term shell integration. Generated per session; safe to delete.
if [ -n "$DOOM_TERM_USER_ZDOTDIR" ]; then
  export ZDOTDIR="$DOOM_TERM_USER_ZDOTDIR"
else
  unset ZDOTDIR
fi
[ -f "${ZDOTDIR:-$HOME}/.zshrc" ] && source "${ZDOTDIR:-$HOME}/.zshrc"

__doom_term_osc() {
  if [ -n "$TMUX" ]; then
    print -n "\033Ptmux;\033$1\033\\"
  else
    print -n "$1"
  fi
}

__doom_term_precmd() {
  local ec=$?
  __doom_term_osc "\033]133;D;${ec}\007"
  __doom_term_osc "\033]7;file://${HOST}${PWD}\007"
  __doom_term_osc "\033]133;A\007"
}
__doom_term_preexec() { __doom_term_osc "\033]133;C\007" }

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

/// What a shell needs on its command line and in its environment for the
/// integration to take effect.
///
/// This exists as data rather than as CommandBuilder mutation because under
/// tmux we do not spawn the shell — tmux does, from an argv we hand it, into an
/// environment that is the server's rather than ours.
pub struct ShellLaunch {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub fn shell_launch(shell: &str) -> ShellLaunch {
    let mut launch = ShellLaunch { args: Vec::new(), env: Vec::new() };
    if std::env::var("DOOM_TERM_NO_SHELL_INTEGRATION").is_ok() {
        return launch;
    }
    match shell_name(shell).as_str() {
        "bash" => {
            if let Some(path) =
                write_integration_file("bash-integration.sh", &bash_integration_script())
            {
                launch.args.push("--rcfile".to_string());
                launch.args.push(path.to_string_lossy().to_string());
                launch.args.push("-i".to_string());
            }
        }
        "zsh" => {
            if let Ok(existing) = std::env::var("ZDOTDIR") {
                launch
                    .env
                    .push(("DOOM_TERM_USER_ZDOTDIR".to_string(), existing));
            }
            if let Some(path) = write_integration_file(".zshrc", &zsh_integration_script()) {
                if let Some(dir) = path.parent() {
                    launch
                        .env
                        .push(("ZDOTDIR".to_string(), dir.to_string_lossy().to_string()));
                }
            }
        }
        _ => {}
    }
    launch
}

/// Add shell integration to a directly-spawned command. The tmux path uses
/// `shell_launch` instead, so both routes read from one definition.
pub fn apply_shell_integration(cmd: &mut CommandBuilder, shell: &str) {
    let launch = shell_launch(shell);
    for (key, value) in &launch.env {
        cmd.env(key, value);
    }
    for arg in &launch.args {
        cmd.arg(arg);
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
    fn every_emitted_payload_carries_exactly_one_escape() {
        // The tmux passthrough wrapper doubles each ESC in its payload, so a
        // payload with one ESC makes the wrapper a fixed prefix rather than an
        // escaping pass. OSC 133 was already BEL-terminated; OSC 7 used to end
        // in ST, which is a second ESC, so it moved to BEL too.
        //
        // Asserted on the payloads only. The wrapper's OWN terminator is an ST
        // and is supposed to be — grepping the whole script for a backslash
        // would flag that and force the implementation to dodge the test.
        for script in [bash_integration_script(), zsh_integration_script()] {
            let mut seen = 0;
            for line in script.lines().filter(|l| l.contains("]7;file://")) {
                seen += 1;
                assert!(
                    line.contains(r"\007"),
                    "OSC 7 must be BEL-terminated, got: {line}"
                );
                assert!(
                    !line.contains(r"\033\\") && !line.contains(r"\e\\"),
                    "an ST terminator would put a second ESC in the payload: {line}"
                );
            }
            assert_eq!(seen, 1, "OSC 7 must still be emitted, exactly once");
        }
    }

    #[test]
    fn sequences_are_wrapped_for_tmux_only_when_running_under_it() {
        // Outside tmux the wrapper would be printed literally as garbage; inside
        // it, its absence means the sequence is swallowed and the block model
        // goes quiet with no error anywhere.
        for script in [bash_integration_script(), zsh_integration_script()] {
            assert!(script.contains("$TMUX"), "must test for tmux");
            assert!(script.contains("Ptmux;"), "must emit the DCS passthrough");
        }
    }

    #[test]
    fn no_boundary_reaches_the_terminal_without_going_through_the_wrapper() {
        // A half-wrapped script is the worst outcome: under tmux the unwrapped
        // half is swallowed, so blocks open and never close and every command
        // looks like it is still running.
        //
        // A bypass is an OSC written STRAIGHT to stdout. Payload construction
        // inside `$(printf ...)` is not one — that output is captured and handed
        // to the wrapper — so the test looks at what starts a line, not at
        // whether the file mentions printf anywhere.
        for script in [bash_integration_script(), zsh_integration_script()] {
            for line in script.lines() {
                let stmt = line.trim_start();
                assert!(
                    !stmt.starts_with(r#"printf '\033]"#) && !stmt.starts_with(r#"print -n "\033]"#),
                    "this writes an OSC past the wrapper: {line}"
                );
            }
        }

        let bash = bash_integration_script();
        for marker in ["133;A", "133;B", "133;C", "133;D", "]7;file://"] {
            assert!(bash.contains(marker), "missing {marker}");
        }
    }

    #[test]
    fn a_launch_reports_the_args_and_env_the_shell_needs() {
        // tmux runs the shell for us, so the integration can no longer be
        // applied by mutating a CommandBuilder — the arguments have to be
        // available as data that can also be threaded through tmux's argv.
        let bash = shell_launch("/bin/bash");
        assert_eq!(bash.args.first().map(String::as_str), Some("--rcfile"));
        assert!(bash.args.contains(&"-i".to_string()));

        let zsh = shell_launch("/usr/bin/zsh");
        assert!(zsh.args.is_empty(), "zsh is configured by ZDOTDIR, not by args");
        assert!(zsh.env.iter().any(|(k, _)| k == "ZDOTDIR"));

        let fish = shell_launch("/usr/bin/fish");
        assert!(fish.args.is_empty() && fish.env.is_empty(), "unknown shells are untouched");
    }

    #[test]
    fn integration_is_only_injected_for_shells_it_understands() {
        assert!(supports_integration("/bin/bash"));
        assert!(supports_integration("/usr/bin/zsh"));
        assert!(!supports_integration("/usr/bin/fish"));
        assert!(!supports_integration("/bin/sh"));
    }
}
