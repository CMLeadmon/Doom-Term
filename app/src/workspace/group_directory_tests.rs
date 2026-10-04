use std::process::Command;

use super::*;

fn remote(directory: &str) -> GroupDirectory {
    GroupDirectory::Ssh {
        host: "example.com".into(),
        username: Some("tester".into()),
        port: Some(2222),
        directory: directory.into(),
    }
}

#[test]
fn ssh_arguments_preserve_literal_remote_paths() {
    for path in [
        "/tmp/a b",
        "/tmp/a'b",
        "/tmp/$(touch unwanted); x",
        "~/projects",
    ] {
        let command = remote(path)
            .startup_command(CommandShell::Posix)
            .unwrap()
            .unwrap();
        let output = Command::new("sh")
            .arg("-c")
            .arg(format!("ssh() {{ printf '%s\\n' \"$@\"; }}; {command}"))
            .output()
            .unwrap();
        assert!(output.status.success());
        let output = String::from_utf8(output.stdout).unwrap();
        let arguments: Vec<_> = output.lines().collect();
        assert_eq!(
            &arguments[..5],
            ["-t", "-p", "2222", "--", "tester@example.com"]
        );
        let remote_command = arguments[5];
        assert!(remote_command.contains("&& exec"));
        assert!(remote_command.contains("cd --"));
        assert!(!command.contains("password"));
        assert!(remote_command.starts_with("/bin/sh -c "));
        let payload = remote_command.strip_prefix("/bin/sh -c ").unwrap();
        let decoded_payload = Command::new("sh")
            .arg("-c")
            .arg(format!("printf '%s' {payload}"))
            .output()
            .unwrap();
        let decoded = Command::new("sh")
            .arg("-c")
            .arg(format!(
                "cd() {{ printf '%s' \"$2\"; }}; {}",
                String::from_utf8(decoded_payload.stdout).unwrap()
            ))
            .env("SHELL", "/bin/true")
            .output()
            .unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        let expected = if let Some(relative) = path.strip_prefix("~/") {
            format!("{}/{relative}", std::env::var("HOME").unwrap())
        } else {
            path.to_owned()
        };
        assert_eq!(String::from_utf8(decoded.stdout).unwrap(), expected);
    }
}

#[test]
fn ssh_rejects_options_and_control_characters() {
    for host in [
        "-oProxyCommand=evil",
        "host\ncommand",
        "host name",
        "user@host",
        "",
    ] {
        let mut config = remote("/tmp");
        if let GroupDirectory::Ssh { host: value, .. } = &mut config {
            *value = host.into();
        }
        assert!(config.validate().is_err(), "{host}");
    }
    let mut config = remote("/tmp");
    if let GroupDirectory::Ssh { username, .. } = &mut config {
        *username = Some("-bad".into());
    }
    assert!(config.validate().is_err());
    let mut config = remote("/tmp");
    if let GroupDirectory::Ssh { port, .. } = &mut config {
        *port = Some(0);
    }
    assert!(config.validate().is_err());
}

#[test]
fn local_directory_and_missing_directory_validation() {
    let directory = GroupDirectory::Local {
        directory: std::env::temp_dir().to_string_lossy().into(),
    };
    assert!(directory.validate().is_ok());
    assert_eq!(directory.local_path(), Some(std::env::temp_dir()));
    let home = GroupDirectory::Local {
        directory: "~".into(),
    };
    let home_path = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap();
    assert_eq!(home.local_path(), Some(PathBuf::from(home_path)));
    assert!(home.validate().is_ok());
    assert_eq!(
        directory.startup_command(CommandShell::Posix).unwrap(),
        None
    );
    assert!(
        GroupDirectory::Local {
            directory: ".".into()
        }
        .validate()
        .is_err()
    );
    assert!(
        GroupDirectory::Local {
            directory: "/missing-doomterm-group-directory".into()
        }
        .validate()
        .is_err()
    );
}

#[test]
fn configuration_round_trips_without_credentials() {
    for config in [
        remote("/tmp/a'b"),
        GroupDirectory::Local {
            directory: "/tmp".into(),
        },
    ] {
        let json = serde_json::to_string(&config).unwrap();
        assert_eq!(
            serde_json::from_str::<GroupDirectory>(&json).unwrap(),
            config
        );
        assert!(!json.contains("password"));
    }
}

#[test]
fn powershell_uses_literal_quoting() {
    let command = remote("/tmp/a'b $HOME")
        .startup_command(CommandShell::PowerShell)
        .unwrap()
        .unwrap();
    assert!(command.starts_with("& ssh "));
    assert!(command.contains("''"));
}

#[test]
fn remote_directory_failure_does_not_start_a_shell() {
    let command = remote("/missing-doomterm-remote-directory")
        .startup_command(CommandShell::Posix)
        .unwrap()
        .unwrap();
    let encoded = Command::new("sh")
        .arg("-c")
        .arg(format!("ssh() {{ printf '%s' \"$6\"; }}; {command}"))
        .output()
        .unwrap();
    let output = Command::new("sh")
        .arg("-c")
        .arg(String::from_utf8(encoded.stdout).unwrap())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr).unwrap().contains("cd"));
}

#[test]
fn fish_preserves_nested_ssh_quoting() {
    let command = remote("/tmp/a'b \\ $HOME; literal")
        .startup_command(CommandShell::Fish)
        .unwrap()
        .unwrap();
    if Command::new("fish").arg("--version").output().is_err() {
        return;
    }
    let output = Command::new("fish")
        .arg("-c")
        .arg(format!(
            "function ssh; printf '%s\\n' $argv; end; {command}"
        ))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let arguments = String::from_utf8(output.stdout).unwrap();
    assert_eq!(arguments.lines().nth(4), Some("tester@example.com"));
    let posix = remote("/tmp/a'b \\ $HOME; literal")
        .startup_command(CommandShell::Posix)
        .unwrap()
        .unwrap();
    let output = Command::new("sh")
        .arg("-c")
        .arg(format!("ssh() {{ printf '%s\\n' \"$@\"; }}; {posix}"))
        .output()
        .unwrap();
    assert_eq!(arguments, String::from_utf8(output.stdout).unwrap());
}

#[cfg(unix)]
#[test]
fn remote_login_shell_preserves_literal_directories() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("doomterm-remote-paths-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let probe = root.join("probe-shell");
    fs::write(&probe, "#!/bin/sh\nprintf '%s' \"$PWD\"\n").unwrap();
    fs::set_permissions(&probe, fs::Permissions::from_mode(0o700)).unwrap();
    for name in ["a b", "a'b", "a\\b", "a`false`$(false);b"] {
        let directory = root.join(name);
        fs::create_dir_all(&directory).unwrap();
        let command = remote(directory.to_str().unwrap())
            .startup_command(CommandShell::Posix)
            .unwrap()
            .unwrap();
        let encoded = Command::new("sh")
            .arg("-c")
            .arg(format!("ssh() {{ printf '%s' \"$6\"; }}; {command}"))
            .output()
            .unwrap();
        let payload = String::from_utf8(encoded.stdout).unwrap();
        for shell in ["sh", "fish"] {
            if Command::new(shell).arg("--version").output().is_err() {
                continue;
            }
            let output = Command::new(shell)
                .arg("-c")
                .arg(&payload)
                .env("SHELL", &probe)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{shell}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                directory.to_str().unwrap(),
                "{shell}"
            );
        }
    }
    fs::remove_dir_all(root).unwrap();
}
