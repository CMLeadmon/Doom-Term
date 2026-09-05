import path from 'node:path';

/**
 * Where Cargo actually writes a binary, given how it was invoked.
 *
 * This used to be a list of guesses — `<target-dir>/release`, `target/release`,
 * `backend/target/release` — filtered for existence and then reduced to
 * whichever file was NEWEST. Two things were wrong with that.
 *
 * It could not find a cross-compiled build at all: `cargo build --target
 * <triple>` writes to `<target-dir>/<triple>/release/`, which was not in the
 * list, so a correct build failed with "none of the candidate binary paths
 * exist".
 *
 * Worse, when a stale HOST binary happened to be sitting in one of the searched
 * directories, the newest-file rule selected it — and the caller then copied it
 * out under the requested target triple's name. A binary for the wrong
 * architecture, labelled as if it were for the right one, is not a build
 * failure the packager can see; it is one the user finds.
 *
 * So: one path, derived from the invocation, and no fallback. If it is not
 * there, the build did not produce what it claimed to.
 */
export function sidecarBinaryPath({ targetDirectory, triple, name, exe = '' }) {
  if (!targetDirectory) throw new Error('sidecarBinaryPath needs the cargo target directory');
  if (!name) throw new Error('sidecarBinaryPath needs the binary name');
  // `triple` present means --target was passed, which adds a directory level.
  // Absent means a host build, which does not.
  const parts = triple ? [targetDirectory, triple, 'release'] : [targetDirectory, 'release'];
  return path.join(...parts, `${name}${exe}`);
}

/**
 * The `target_directory` Cargo itself reports for a manifest.
 *
 * Asked rather than assumed: it moves with CARGO_TARGET_DIR, with
 * `build.target-dir` in any applicable config.toml, and with workspace
 * membership — a backend crate inside a workspace builds into the WORKSPACE's
 * target directory, not its own. Guessing at that is what produced the list of
 * candidate paths this replaces.
 */
export function cargoTargetDirectory(manifestPath, run) {
  const raw = run('cargo', [
    'metadata',
    '--format-version', '1',
    '--no-deps',
    '--manifest-path', manifestPath,
  ]);
  const parsed = JSON.parse(raw);
  if (!parsed.target_directory) {
    throw new Error('cargo metadata did not report a target_directory');
  }
  return parsed.target_directory;
}
