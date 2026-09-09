//! Bounded helper I/O. Never call from an async executor thread.
use anyhow::Result;
use std::{path::Path, time::Duration};

#[cfg(unix)]
pub(crate) fn run(exe: &Path, args: &[String], input: &[u8], timeout: Duration) -> Result<Vec<u8>> {
    use std::io::{ErrorKind, Read, Write};
    use std::os::{fd::AsRawFd, unix::process::CommandExt};
    use std::process::{Command, Stdio};
    use std::time::Instant;

    anyhow::ensure!(
        input.len() <= crate::paste::MAX_PASTE_BYTES,
        "Paste exceeds the 1 MiB limit"
    );
    let deadline = Instant::now() + timeout;
    let mut child = Command::new(exe)
        .args(args)
        .env_remove("TMUX")
        .env_remove("TMUX_PANE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| anyhow::anyhow!("Paste helper could not start"))?;
    let result = (|| -> Result<Vec<u8>> {
        let mut stdin = child.stdin.take();
        let mut stdout = child.stdout.take().unwrap();
        for fd in [stdin.as_ref().unwrap().as_raw_fd(), stdout.as_raw_fd()] {
            // These are owned pipe descriptors, live throughout this call.
            let flags = unsafe { nix::libc::fcntl(fd, nix::libc::F_GETFL) };
            anyhow::ensure!(
                flags >= 0
                    && unsafe {
                        nix::libc::fcntl(fd, nix::libc::F_SETFL, flags | nix::libc::O_NONBLOCK)
                    } >= 0,
                "Paste helper pipe setup failed"
            );
        }
        let mut written = 0;
        let mut output = Vec::new();
        let mut eof = false;
        loop {
            anyhow::ensure!(
                Instant::now() < deadline,
                "Paste helper timed out; delivery is unknown"
            );
            if written == input.len() {
                stdin.take();
            }
            if let Some(pipe) = stdin.as_mut() {
                match pipe.write(&input[written..]) {
                    Ok(0) => anyhow::bail!("Paste helper closed its input"),
                    Ok(n) => written += n,
                    Err(e)
                        if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                    Err(_) => anyhow::bail!("Paste helper input failed; delivery is unknown"),
                }
            }
            let mut buffer = [0; 4096];
            match stdout.read(&mut buffer) {
                Ok(0) => eof = true,
                Ok(n) => {
                    anyhow::ensure!(
                        output.len() + n <= 4096,
                        "Paste helper exceeded output limit"
                    );
                    output.extend_from_slice(&buffer[..n]);
                }
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                Err(_) => anyhow::bail!("Paste helper output failed; delivery is unknown"),
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|_| anyhow::anyhow!("Paste helper wait failed"))?
            {
                anyhow::ensure!(
                    status.success() && written == input.len(),
                    "Paste helper failed; delivery is unknown"
                );
                if eof {
                    return Ok(output);
                }
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    })();
    if result.is_err() {
        // Kill only this helper's process group, including a stalled descendant
        // holding a pipe open. No pipe worker threads are left to join forever.
        let _ = nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(child.id() as i32),
            nix::sys::signal::Signal::SIGKILL,
        );
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

#[cfg(not(unix))]
pub(crate) fn run(
    _exe: &Path,
    _args: &[String],
    _input: &[u8],
    _timeout: Duration,
) -> Result<Vec<u8>> {
    anyhow::bail!("Child-checked tmux paste is unsupported on this platform")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn pumps_stdin_and_stdout_without_blocking_on_either_pipe() {
        let result = run(
            Path::new("/bin/sh"),
            &["-c".into(), "head -c 1000; cat >/dev/null".into()],
            &vec![b'x'; 1024 * 1024],
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(result, vec![b'x'; 1000]);
    }

    #[test]
    fn hanging_helper_is_killed_within_deadline_even_if_it_never_reads() {
        let started = Instant::now();
        let error = run(
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30".into()],
            &vec![b'x'; 1024 * 1024],
            Duration::from_millis(100),
        )
        .unwrap_err();
        assert!(error.to_string().contains("timed out"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn output_is_bounded_and_errors_do_not_echo_helper_output() {
        let error = run(
            Path::new("/bin/sh"),
            &["-c".into(), "head -c 5000 /dev/zero".into()],
            &[],
            Duration::from_secs(2),
        )
        .unwrap_err();
        assert!(error.to_string().contains("output limit"), "{error}");
        let error = run(
            Path::new("/bin/sh"),
            &["-c".into(), "echo secret >&2; exit 1".into()],
            &[],
            Duration::from_secs(2),
        )
        .unwrap_err();
        assert!(!error.to_string().contains("secret"));
    }
}
