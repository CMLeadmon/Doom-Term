//! Executable configuration must never be written through a predictable path
//! in a shared temporary directory. Create a private directory atomically and
//! publish complete files by rename, without following an existing file link.
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

fn directory() -> io::Result<&'static PathBuf> {
    static DIRECTORY: OnceLock<Result<PathBuf, io::Error>> = OnceLock::new();
    DIRECTORY
        .get_or_init(|| {
            let base = std::env::var_os("XDG_RUNTIME_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            let mut builder = tempfile::Builder::new();
            builder.prefix("doom-term-");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // tempfile's directory default is 0777, unlike its file default.
                builder.permissions(std::fs::Permissions::from_mode(0o700));
            }
            // Durable shells outlive this daemon and may still need their rcfile.
            // Keep this small per-run directory; runtime-directory cleanup owns it.
            builder.tempdir_in(base).map(|dir| dir.keep())
        })
        .as_ref()
        .map_err(|err| io::Error::new(err.kind(), err.to_string()))
}

pub(crate) fn write(name: &str, body: &str) -> io::Result<PathBuf> {
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "runtime file requires a basename",
        ));
    }
    let dir = directory()?;
    let path = dir.join(name);
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    file.write_all(body.as_bytes())?;
    file.persist(&path).map_err(|err| err.error)?;
    Ok(path)
}
