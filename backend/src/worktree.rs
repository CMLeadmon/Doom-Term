use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn create(cwd: &Path, branch: &str) -> Result<PathBuf> {
    anyhow::ensure!(
        !branch.is_empty() && !branch.starts_with('-') && !branch.contains("@{"),
        "Invalid branch name"
    );
    git(cwd, &["check-ref-format", &format!("refs/heads/{branch}")])?;
    let root = PathBuf::from(git(cwd, &["rev-parse", "--show-toplevel"])?);
    let parent = root
        .parent()
        .context("Repository has no parent directory")?;
    let name = root
        .file_name()
        .context("Repository has no directory name")?
        .to_string_lossy();
    // A sibling keeps the new checkout out of the source repository's status.
    // Git refuses existing destinations and branches; never force or remove.
    let path = parent.join(format!("{name}-worktree-{}", branch.replace('/', "-")));
    let output = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["worktree", "add", "-b", branch, "--"])
        .arg(&path)
        .arg("HEAD")
        .output()
        .context("Could not run git worktree add")?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(path)
}

fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .context("Could not run git")?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(String::from_utf8(output.stdout)?
        .trim_end_matches('\n')
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "doom-worktree-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&dir).unwrap();
            let fixture = Self(dir);
            std::fs::create_dir(fixture.0.join("source repo")).unwrap();
            fixture.git(&["init", "-b", "trunk"]);
            fixture.git(&[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "fixture",
            ]);
            fixture
        }
        fn git(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .arg("-C")
                .arg(self.0.join("source repo"))
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8(out.stdout).unwrap().trim().to_string()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_from_current_head_without_a_main_branch_or_shell_input() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source repo");
        std::fs::create_dir(source.join("nested")).unwrap();
        let path = create(&source.join("nested"), "feature/real-worktree").unwrap();
        assert!(path.join(".git").is_file());
        assert!(path.starts_with(&fixture.0) && !path.starts_with(&source));
        let out = Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(["branch", "--show-current"])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "feature/real-worktree"
        );
        assert_eq!(fixture.git(&["branch", "--show-current"]), "trunk");
        assert_eq!(
            fixture.git(&["rev-parse", "HEAD"]),
            fixture.git(&["rev-parse", "feature/real-worktree"])
        );
        assert!(create(&source, "feature/real-worktree").is_err());
        assert!(
            path.join(".git").is_file(),
            "existing work must survive a duplicate request"
        );
    }

    #[test]
    fn rejects_invalid_branches_and_non_repositories_without_creating_work() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source repo");
        for branch in ["", "-f", "../escape", "a b", "@{-1}"] {
            assert!(create(&source, branch).is_err(), "accepted {branch}");
        }
        assert!(create(&fixture.0, "feature").is_err());
        assert_eq!(
            fixture
                .git(&["worktree", "list", "--porcelain"])
                .matches("worktree ")
                .count(),
            1
        );
    }
}
