use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum DemuxEvent {
    Output { data: String },
    PromptStart,
    CommandStart,
    ExecutionStart,
    ExecutionEnd { exit_code: Option<i32> },
    TuiMode { active: bool },
    AgentState { state: String },
    Cwd { path: String },
}

/// An OSC payload is a control record, never text. Anything longer than this is
/// a stream that lost sync, so we drop it rather than buffer without bound.
const MAX_OSC_LEN: usize = 4096;

pub struct StreamDemuxer {
    in_esc: bool,
    in_osc: bool,
    osc_buf: Vec<u8>,
    in_csi: bool,
    csi_buf: Vec<u8>,
    tui_active: bool,
}

impl StreamDemuxer {
    pub fn new() -> Self {
        Self {
            in_esc: false,
            in_osc: false,
            osc_buf: Vec::with_capacity(256),
            in_csi: false,
            csi_buf: Vec::with_capacity(64),
            tui_active: false,
        }
    }

    pub fn process_bytes(&mut self, bytes: &[u8]) -> Vec<DemuxEvent> {
        let mut events = Vec::new();
        let mut output_chunk = Vec::new();

        let mut i = 0;
        while i < bytes.len() {
            let b = bytes[i];

            if self.in_osc {
                self.osc_buf.push(b);
                let is_bel = b == 0x07;
                let is_st = self.osc_buf.len() >= 2
                    && self.osc_buf[self.osc_buf.len() - 2] == 0x1b
                    && self.osc_buf[self.osc_buf.len() - 1] == b'\\';

                if is_bel || is_st || self.osc_buf.len() > MAX_OSC_LEN {
                    self.in_osc = false;
                    let osc_slice = if is_st {
                        &self.osc_buf[..self.osc_buf.len().saturating_sub(2)]
                    } else if is_bel {
                        &self.osc_buf[..self.osc_buf.len().saturating_sub(1)]
                    } else {
                        &self.osc_buf[..]
                    };

                    // An OSC record is never printable. If we do not understand
                    // it we drop it: forwarding the bytes is what put
                    // `]0;user@host` and `]3008;machineid=…` on the screen.
                    if let Ok(osc_str) = std::str::from_utf8(osc_slice) {
                        if let Some(event) = self.parse_osc_command(osc_str) {
                            if !output_chunk.is_empty() {
                                events.push(DemuxEvent::Output {
                                    data: String::from_utf8_lossy(&output_chunk).to_string(),
                                });
                                output_chunk.clear();
                            }
                            events.push(event);
                        }
                    }
                    self.osc_buf.clear();
                }
                i += 1;
                continue;
            }

            if self.in_csi {
                self.csi_buf.push(b);
                if (0x40..=0x7e).contains(&b) {
                    self.in_csi = false;
                    if let Ok(csi_str) = std::str::from_utf8(&self.csi_buf) {
                        if csi_str == "?1049h" || csi_str == "?47h" || csi_str == "?1047h" {
                            if !self.tui_active {
                                self.tui_active = true;
                                if !output_chunk.is_empty() {
                                    events.push(DemuxEvent::Output {
                                        data: String::from_utf8_lossy(&output_chunk).to_string(),
                                    });
                                    output_chunk.clear();
                                }
                                events.push(DemuxEvent::TuiMode { active: true });
                            }
                        } else if csi_str == "?1049l" || csi_str == "?47l" || csi_str == "?1047l" {
                            if self.tui_active {
                                self.tui_active = false;
                                if !output_chunk.is_empty() {
                                    events.push(DemuxEvent::Output {
                                        data: String::from_utf8_lossy(&output_chunk).to_string(),
                                    });
                                    output_chunk.clear();
                                }
                                events.push(DemuxEvent::TuiMode { active: false });
                            }
                        }
                    }
                    output_chunk.push(0x1b);
                    output_chunk.push(b'[');
                    output_chunk.extend_from_slice(&self.csi_buf);
                    self.csi_buf.clear();
                }
                i += 1;
                continue;
            }

            // ESC is tracked as state rather than by peeking at the next byte:
            // a read can end exactly on the ESC, and the old lookahead emitted
            // it as text and then failed to recognise the sequence that followed.
            if self.in_esc {
                self.in_esc = false;
                if b == b']' {
                    self.in_osc = true;
                    self.osc_buf.clear();
                    self.osc_buf.push(0x1b);
                    self.osc_buf.push(b']');
                    i += 1;
                    continue;
                }
                if b == b'[' {
                    self.in_csi = true;
                    self.csi_buf.clear();
                    i += 1;
                    continue;
                }
                // Some other ESC sequence — hand it to the renderer intact.
                output_chunk.push(0x1b);
                output_chunk.push(b);
                i += 1;
                continue;
            }

            if b == 0x1b {
                self.in_esc = true;
                i += 1;
                continue;
            }

            output_chunk.push(b);
            i += 1;
        }

        if !output_chunk.is_empty() {
            events.push(DemuxEvent::Output {
                data: String::from_utf8_lossy(&output_chunk).to_string(),
            });
        }

        events
    }

    fn parse_osc_command(&self, osc_content: &str) -> Option<DemuxEvent> {
        let trimmed = osc_content.trim_start_matches("\x1b]").trim();
        
        // OSC 133 Shell Integration
        if trimmed.starts_with("133;") {
            let parts: Vec<&str> = trimmed.split(';').collect();
            if parts.len() < 2 {
                return None;
            }

            return match parts[1] {
                "A" => Some(DemuxEvent::PromptStart),
                "B" => Some(DemuxEvent::CommandStart),
                "C" => Some(DemuxEvent::ExecutionStart),
                "D" => {
                    let exit_code = if parts.len() >= 3 {
                        parts[2].parse::<i32>().ok()
                    } else {
                        None
                    };
                    Some(DemuxEvent::ExecutionEnd { exit_code })
                }
                _ => None,
            };
        }

        // OSC 7 — the shell's own report of where it is: file://host/path
        if let Some(rest) = trimmed.strip_prefix("7;") {
            if let Some(after_scheme) = rest.trim().strip_prefix("file://") {
                if let Some(slash) = after_scheme.find('/') {
                    return Some(DemuxEvent::Cwd {
                        path: percent_decode(&after_scheme[slash..]),
                    });
                }
            }
            return None;
        }

        // OSC 3008 — ptyxis/Bazzite shell integration. It carries cwd= on every
        // prompt, which is a better source of truth than the daemon's own
        // process directory, and it used to be printed verbatim to the screen.
        if trimmed.starts_with("3008;") {
            for field in trimmed.split(';') {
                if let Some(dir) = field.strip_prefix("cwd=") {
                    if !dir.is_empty() {
                        return Some(DemuxEvent::Cwd {
                            path: dir.to_string(),
                        });
                    }
                }
            }
            return None;
        }

        // OSC 1337 Agent State Hooks (e.g. \x1b]1337;AgentState=running\x07)
        if trimmed.starts_with("1337;") {
            let body = &trimmed[5..];
            if body.starts_with("AgentState=") {
                let state = body["AgentState=".len()..].trim().to_lowercase();
                return Some(DemuxEvent::AgentState { state });
            }
        }

        None
    }
}

/// Minimal percent-decoding for OSC 7 paths (spaces arrive as %20).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_osc_133_demuxing() {
        let mut demuxer = StreamDemuxer::new();

        // Feed OSC 133 sequences
        let input = b"\x1b]133;A\x07Hello World\r\n\x1b]133;B\x1b\\\x1b]133;C\x07Running command\r\n\x1b]133;D;0\x07";
        let events = demuxer.process_bytes(input);

        assert!(events.iter().any(|e| matches!(e, DemuxEvent::PromptStart)));
        assert!(events.iter().any(|e| matches!(e, DemuxEvent::CommandStart)));
        assert!(events.iter().any(|e| matches!(e, DemuxEvent::ExecutionStart)));
        assert!(events.iter().any(|e| matches!(e, DemuxEvent::ExecutionEnd { exit_code: Some(0) })));
    }

    #[test]
    fn test_osc_1337_agent_state() {
        let mut demuxer = StreamDemuxer::new();
        let input = b"\x1b]1337;AgentState=waiting_input\x07";
        let events = demuxer.process_bytes(input);
        assert!(events.iter().any(|e| matches!(e, DemuxEvent::AgentState { ref state } if state == "waiting_input")));
    }

    #[test]
    fn unrecognised_osc_is_never_forwarded_to_the_renderer() {
        let mut demuxer = StreamDemuxer::new();
        let input = b"\x1b]0;cleadmon@SER6-MAX:~/Projects\x07\x1b]11;?\x1b\\backend  index.html";
        let events = demuxer.process_bytes(input);
        let text: String = events
            .iter()
            .filter_map(|e| match e {
                DemuxEvent::Output { data } => Some(data.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "backend  index.html", "OSC payloads must not reach the screen");
    }

    #[test]
    fn osc_3008_reports_the_working_directory() {
        let mut demuxer = StreamDemuxer::new();
        let input = b"\x1b]3008;start=abc;machineid=def;user=x;cwd=/home/me/Projects/Doom Term\x1b\\";
        let events = demuxer.process_bytes(input);
        assert!(events
            .iter()
            .any(|e| matches!(e, DemuxEvent::Cwd { path } if path == "/home/me/Projects/Doom Term")));
    }

    #[test]
    fn osc_7_reports_the_working_directory() {
        let mut demuxer = StreamDemuxer::new();
        let events = demuxer.process_bytes(b"\x1b]7;file://host/home/me/src\x07");
        assert!(events
            .iter()
            .any(|e| matches!(e, DemuxEvent::Cwd { path } if path == "/home/me/src")));
    }

    #[test]
    fn an_escape_split_across_chunks_is_still_demuxed() {
        let mut demuxer = StreamDemuxer::new();
        let first = demuxer.process_bytes(b"done\x1b");
        let text: String = first
            .iter()
            .filter_map(|e| match e {
                DemuxEvent::Output { data } => Some(data.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "done", "a trailing ESC must be held, not emitted");

        let second = demuxer.process_bytes(b"]133;D;0\x07");
        assert!(second
            .iter()
            .any(|e| matches!(e, DemuxEvent::ExecutionEnd { exit_code: Some(0) })));
    }

    #[test]
    fn test_decset_1049_tui_mode() {
        let mut demuxer = StreamDemuxer::new();

        // Enter alternate buffer
        let enter = b"\x1b[?1049h";
        let events = demuxer.process_bytes(enter);
        assert!(events.iter().any(|e| matches!(e, DemuxEvent::TuiMode { active: true })));

        // Exit alternate buffer
        let exit = b"\x1b[?1049l";
        let events2 = demuxer.process_bytes(exit);
        assert!(events2.iter().any(|e| matches!(e, DemuxEvent::TuiMode { active: false })));
    }
}
