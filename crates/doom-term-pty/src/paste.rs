//! Clipboard admission shared by both PTY transports.
use anyhow::Result;

pub const MAX_PASTE_BYTES: usize = 1024 * 1024;

pub fn prepare_paste(text: &str) -> Result<String> {
    anyhow::ensure!(
        text.len() <= MAX_PASTE_BYTES,
        "Paste exceeds the 1 MiB limit"
    );
    let mut clean = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                clean.push('\n');
            }
            '\t' | '\n' => clean.push(ch),
            '\x00'..='\x1f' | '\x7f' => {}
            _ => clean.push(ch),
        }
    }
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_newlines_and_removes_control_injection() {
        assert_eq!(
            prepare_paste("one\rtwo\r\n三\t\x03").unwrap(),
            "one\ntwo\n三\t"
        );
        assert_eq!(
            prepare_paste("'\"$();\\\x1b[201~\x00\x7f").unwrap(),
            "'\"$();\\[201~"
        );
        assert_eq!(prepare_paste("\x00\x03\x1b\x7f").unwrap(), "");
    }

    #[test]
    fn rejects_oversized_input_before_sanitization() {
        assert!(prepare_paste(&"x".repeat(MAX_PASTE_BYTES)).is_ok());
        assert!(prepare_paste(&"\x00".repeat(MAX_PASTE_BYTES + 1)).is_err());
        assert!(prepare_paste(&"三".repeat(MAX_PASTE_BYTES / 3 + 1)).is_err());
    }
}
