use command::blocking::Command;
use doomterm_plate::DiffStats;

use super::{branch, diff_stats, parse_shortstat};

#[test]
fn shortstat_forms() {
    assert_eq!(
        parse_shortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)\n"),
        DiffStats {
            added: 10,
            removed: 2,
            files: 3
        }
    );
    assert_eq!(
        parse_shortstat(" 1 file changed, 1 insertion(+)\n"),
        DiffStats {
            added: 1,
            removed: 0,
            files: 1
        }
    );
    assert_eq!(
        parse_shortstat(" 2 files changed, 7 deletions(-)\n"),
        DiffStats {
            added: 0,
            removed: 7,
            files: 2
        }
    );
    assert_eq!(parse_shortstat(""), DiffStats::default());
}

#[test]
fn real_repository_counts_and_non_repository_is_unknown() {
    let dir = std::env::temp_dir().join(format!("doomterm-git-diff-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(diff_stats(&dir), None, "a plain directory has no diff");
    assert_eq!(branch(&dir), None, "a plain directory has no branch");

    let git = |args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    };
    git(&["init", "-q", "-b", "feature/plate"]);
    std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
    git(&["add", "a.txt"]);
    git(&["commit", "-q", "-m", "init"]);
    assert_eq!(
        diff_stats(&dir),
        Some(DiffStats::default()),
        "a clean tree is zero, not unknown"
    );
    assert_eq!(branch(&dir).as_deref(), Some("feature/plate"));
    git(&["checkout", "-q", "--detach"]);
    let detached = branch(&dir).expect("a detached HEAD still names a commit");
    assert!(
        detached.len() >= 7 && detached.chars().all(|c| c.is_ascii_hexdigit()),
        "{detached}"
    );
    git(&["checkout", "-q", "feature/plate"]);

    std::fs::write(dir.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
    assert_eq!(
        diff_stats(&dir),
        Some(DiffStats {
            added: 2,
            removed: 1,
            files: 1
        })
    );
}
