//! Uncommitted line changes of the repository containing a directory.

use std::path::Path;

use command::blocking::Command;
use doomterm_plate::DiffStats;

/// Runs `git diff --shortstat HEAD` in `dir`. Blocking; call it off the UI thread.
///
/// Returns `None` outside a repository or when git is unavailable, and zero counts for a clean
/// tree.
pub fn diff_stats(dir: &Path) -> Option<DiffStats> {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["--no-optional-locks", "diff", "--shortstat", "HEAD"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| parse_shortstat(&String::from_utf8_lossy(&output.stdout)))
}

/// The checked-out branch of the repository containing `dir`, or the short commit hash when HEAD
/// is detached. Blocking; call it off the UI thread.
pub fn branch(dir: &Path) -> Option<String> {
    let git = |args: &[&str]| {
        let output = Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("--no-optional-locks")
            .args(args)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (output.status.success() && !text.is_empty()).then_some(text)
    };
    git(&["symbolic-ref", "--short", "-q", "HEAD"])
        .or_else(|| git(&["rev-parse", "--short", "HEAD"]))
}

/// Parses `" 3 files changed, 10 insertions(+), 2 deletions(-)"`; git omits zero clauses and uses
/// singular forms for one.
pub fn parse_shortstat(line: &str) -> DiffStats {
    let mut stats = DiffStats::default();
    for clause in line.split(',') {
        let mut words = clause.split_whitespace();
        let (Some(count), Some(kind)) = (words.next(), words.next()) else {
            continue;
        };
        let Ok(count) = count.parse::<u32>() else {
            continue;
        };
        if kind.starts_with("file") {
            stats.files = count;
        } else if kind.starts_with("insertion") {
            stats.added = count;
        } else if kind.starts_with("deletion") {
            stats.removed = count;
        }
    }
    stats
}

#[cfg(test)]
#[path = "git_diff_tests.rs"]
mod tests;
