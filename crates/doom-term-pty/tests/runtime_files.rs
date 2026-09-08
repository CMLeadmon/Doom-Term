//! Run the real launch/config writers with an isolated environment. No tests
//! mutate the parent process's XDG_RUNTIME_DIR or touch its generated scripts.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::process::Command;

#[test]
fn generated_scripts_do_not_follow_preexisting_runtime_symlinks() {
    if std::env::var_os("DOOM_RUNTIME_TEST_CHILD").is_some() {
        let base = std::path::PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR").unwrap());
        let config = doom_term_pty::tmux::write_config().expect("config is writable");
        let bash = doom_term_pty::shell_integration::shell_launch("/bin/bash");
        let script = std::path::PathBuf::from(&bash.args[1]);
        for path in [config, script] {
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        assert_eq!(
            fs::read_to_string(base.join("victim")).unwrap(),
            "do not overwrite me"
        );
        return;
    }

    let fixture = tempfile::tempdir().unwrap();
    let old_dir = fixture.path().join("doom-term");
    fs::create_dir(&old_dir).unwrap();
    let victim = fixture.path().join("victim");
    fs::write(&victim, "do not overwrite me").unwrap();
    symlink(&victim, old_dir.join("tmux.conf")).unwrap();
    symlink(&victim, old_dir.join("bash-integration.sh")).unwrap();
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "generated_scripts_do_not_follow_preexisting_runtime_symlinks",
            "--nocapture",
        ])
        .env("DOOM_RUNTIME_TEST_CHILD", "1")
        .env("XDG_RUNTIME_DIR", fixture.path())
        .env_remove("DOOM_TERM_NO_SHELL_INTEGRATION")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
