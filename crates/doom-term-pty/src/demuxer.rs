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

/// What we tell a program that asks what we look like. These are the real
/// design tokens — `--ground` and `--ink` in styles/material.css — because a
/// CLI picks its light or dark palette from the answer, and lying here makes
/// agent output unreadable against the plate.
const GROUND_RGB: &str = "rgb:1414/1212/0f0f"; // #14120f
const INK_RGB: &str = "rgb:d8d8/cbcb/b0b0"; // #d8cbb0

pub struct StreamDemuxer {
    in_esc: bool,
    in_osc: bool,
    osc_buf: Vec<u8>,
    in_csi: bool,
    csi_buf: Vec<u8>,
    tui_active: bool,
    in_prompt: bool,
    in_command_echo: bool,
    /// Bytes owed back to the PTY. A terminal that stays silent when asked a
    /// question leaves the asker blocked on its own timeout.
    pending_responses: Vec<u8>,
    /// Trailing bytes of a UTF-8 sequence that the last read cut in half.
    /// At most three, since no sequence is longer than four bytes.
    utf8_tail: Vec<u8>,
}

/// Accumulated output bytes to a renderable String, holding back any trailing
/// INCOMPLETE UTF-8 sequence for the next read to finish.
///
/// A PTY read ends on an arbitrary byte boundary (8192 bytes, `session.rs`), so
/// a multi-byte character routinely straddles two reads. `from_utf8_lossy`
/// turns each half into U+FFFD and the character is lost — the same end-of-read
/// hazard this demuxer already tracks for ESC, left unhandled for UTF-8 until
/// 2026-08-29. Nerd Font icons and box drawing made it visible constantly.
///
/// Only genuinely incomplete trailing bytes are held. Bytes that can never
/// begin or continue a sequence are still replaced, because malformed input
/// must not accumulate forever waiting for a continuation that cannot come.
fn take_output(chunk: &mut Vec<u8>, tail: &mut Vec<u8>) -> String {
    let split = match std::str::from_utf8(chunk) {
        Ok(_) => chunk.len(),
        // `error_len() == None` means the input ENDED mid-sequence: hold it.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // A real encoding error: mark it and move on.
        Err(_) => chunk.len(),
    };
    *tail = chunk.split_off(split);
    let text = String::from_utf8_lossy(chunk).to_string();
    chunk.clear();
    text
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
            in_prompt: false,
            in_command_echo: false,
            pending_responses: Vec::new(),
            utf8_tail: Vec::new(),
        }
    }

    /// Take the bytes owed back to the PTY. The caller must write these to the
    /// shell; until it does, whatever asked is still sitting on a timeout.
    pub fn take_responses(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending_responses)
    }

    /// Answer the "what are you?" probes a real terminal replies to instantly.
    /// Returns true when the record was a query, so the caller knows to keep it
    /// off the screen.
    fn answer_query(&mut self, osc_content: &str) -> bool {
        let trimmed = osc_content.trim_start_matches("\x1b]").trim();
        let reply = match trimmed {
            "11;?" => format!("\x1b]11;{}\x1b\\", GROUND_RGB),
            "10;?" => format!("\x1b]10;{}\x1b\\", INK_RGB),
            _ => return false,
        };
        self.pending_responses.extend_from_slice(reply.as_bytes());
        true
    }

    pub fn process_bytes(&mut self, bytes: &[u8]) -> Vec<DemuxEvent> {
        let mut events = Vec::new();
        // Whatever the last read cut in half rejoins the front of this one.
        let mut output_chunk = std::mem::take(&mut self.utf8_tail);

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
                    let osc_record = std::str::from_utf8(osc_slice).ok().map(str::to_owned);
                    self.osc_buf.clear();

                    // A probe is answered, not parsed — it carries no event and
                    // must not reach the screen.
                    if let Some(osc_str) = osc_record.filter(|s| !self.answer_query(s)) {
                        if let Some(event) = self.parse_osc_command(&osc_str) {
                            match &event {
                                DemuxEvent::PromptStart => {
                                    self.in_prompt = true;
                                    self.in_command_echo = false;
                                }
                                DemuxEvent::CommandStart => {
                                    self.in_prompt = false;
                                    self.in_command_echo = true;
                                }
                                DemuxEvent::ExecutionStart => {
                                    self.in_prompt = false;
                                    self.in_command_echo = false;
                                }
                                DemuxEvent::ExecutionEnd { .. } => {
                                    self.in_prompt = false;
                                    self.in_command_echo = false;
                                }
                                _ => {}
                            }

                            if !output_chunk.is_empty() {
                                events.push(DemuxEvent::Output {
                                    data: String::from_utf8_lossy(&output_chunk).to_string(),
                                });
                                output_chunk.clear();
                            }
                            events.push(event);
                        }
                    }
                }
                i += 1;
                continue;
            }

            if self.in_csi {
                self.csi_buf.push(b);
                if (0x40..=0x7e).contains(&b) {
                    self.in_csi = false;
                    let mut is_query = false;
                    if let Ok(csi_str) = std::str::from_utf8(&self.csi_buf) {
                        if csi_str == "6n" {
                            // Device Status Report. The demuxer does not model a
                            // cursor, so it reports the origin: an approximate
                            // answer costs a repaint, silence costs five seconds.
                            is_query = true;
                        } else if csi_str == "?1049h" || csi_str == "?47h" || csi_str == "?1047h" {
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
                    if is_query {
                        self.pending_responses.extend_from_slice(b"\x1b[1;1R");
                    } else {
                        output_chunk.push(0x1b);
                        output_chunk.push(b'[');
                        output_chunk.extend_from_slice(&self.csi_buf);
                    }
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
                // Some other ESC sequence — hand it to the renderer intact if not in prompt/echo.
                if self.tui_active || (!self.in_prompt && !self.in_command_echo) {
                    output_chunk.push(0x1b);
                    output_chunk.push(b);
                }
                i += 1;
                continue;
            }

            if b == 0x1b {
                self.in_esc = true;
                i += 1;
                continue;
            }

            if self.tui_active || (!self.in_prompt && !self.in_command_echo) {
                output_chunk.push(b);
            }
            i += 1;
        }

        if !output_chunk.is_empty() {
            let data = take_output(&mut output_chunk, &mut self.utf8_tail);
            // A read that was nothing but the head of a split character emits
            // no event at all — the bytes are held, not dropped.
            if !data.is_empty() {
                events.push(DemuxEvent::Output { data });
            }
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

    /// The older tests repeat this filter inline; the UTF-8 cases below need it
    /// several times over.
    fn text_of(events: &[DemuxEvent]) -> String {
        events
            .iter()
            .filter_map(|e| match e {
                DemuxEvent::Output { data } => Some(data.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_multibyte_character_split_across_reads_survives() {
        let mut demuxer = StreamDemuxer::new();
        // "é" is C3 A9. An 8192-byte read lands between them often enough to see
        // it during any agent session that prints accented text or box drawing.
        let first = demuxer.process_bytes(b"caf\xc3");
        assert_eq!(text_of(&first), "caf", "a dangling lead byte must be held, not replaced");

        let second = demuxer.process_bytes(b"\xa9 au lait");
        assert_eq!(text_of(&second), "\u{e9} au lait", "the held byte must rejoin its tail");
    }

    #[test]
    fn a_four_byte_emoji_survives_a_split_at_every_interior_offset() {
        // "🎉" is F0 9F 8E 89, so a read can end after one, two or three of them.
        let emoji = "\u{1f389}".as_bytes();
        for split in 1..emoji.len() {
            let mut demuxer = StreamDemuxer::new();
            let first = demuxer.process_bytes(&emoji[..split]);
            let second = demuxer.process_bytes(&emoji[split..]);
            let text = format!("{}{}", text_of(&first), text_of(&second));
            assert_eq!(
                text, "\u{1f389}",
                "a split after {split} byte(s) must still yield the character"
            );
        }
    }

    #[test]
    fn genuinely_invalid_bytes_are_still_replaced() {
        let mut demuxer = StreamDemuxer::new();
        // FF can never begin a UTF-8 sequence. Holding it would stall the stream
        // forever waiting for a continuation that cannot come.
        let events = demuxer.process_bytes(b"ok\xff");
        assert_eq!(text_of(&events), "ok\u{fffd}", "malformed input must not accumulate");
    }

    #[test]
    fn a_character_split_before_an_escape_is_not_held_past_it() {
        let mut demuxer = StreamDemuxer::new();
        // A truncated character followed by an ESC is malformed input, not a read
        // boundary. Holding it here would reorder text against the event.
        let events = demuxer.process_bytes(b"text\xc3\x1b]133;C\x07");
        assert!(events.iter().any(|e| matches!(e, DemuxEvent::ExecutionStart)));
        assert!(text_of(&events).starts_with("text"), "text must still precede the event");
    }

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

    /// A terminal that never answers a query leaves the asking program blocked
    /// on its own timeout — 5s per probe in the renderer Bazzite runs at login,
    /// which is what put 15s of dead air in front of every new terminal.
    #[test]
    fn background_colour_query_is_answered() {
        let mut demuxer = StreamDemuxer::new();
        demuxer.process_bytes(b"\x1b]11;?\x1b\\");
        let reply = String::from_utf8(demuxer.take_responses()).unwrap();
        assert_eq!(reply, "\x1b]11;rgb:1414/1212/0f0f\x1b\\", "must report --ground");
    }

    #[test]
    fn foreground_colour_query_is_answered() {
        let mut demuxer = StreamDemuxer::new();
        demuxer.process_bytes(b"\x1b]10;?\x1b\\");
        let reply = String::from_utf8(demuxer.take_responses()).unwrap();
        assert_eq!(reply, "\x1b]10;rgb:d8d8/cbcb/b0b0\x1b\\", "must report --ink");
    }

    #[test]
    fn cursor_position_query_is_answered() {
        let mut demuxer = StreamDemuxer::new();
        demuxer.process_bytes(b"\x1b[6n");
        let reply = String::from_utf8(demuxer.take_responses()).unwrap();
        assert_eq!(reply, "\x1b[1;1R", "DSR must get a cursor position report");
    }

    #[test]
    fn a_query_is_not_echoed_to_the_renderer() {
        let mut demuxer = StreamDemuxer::new();
        let events = demuxer.process_bytes(b"\x1b[6nready");
        let text: String = events
            .iter()
            .filter_map(|e| match e {
                DemuxEvent::Output { data } => Some(data.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "ready", "a query is for the terminal, never for the screen");
    }

    #[test]
    fn responses_are_drained_once() {
        let mut demuxer = StreamDemuxer::new();
        demuxer.process_bytes(b"\x1b[6n");
        assert!(!demuxer.take_responses().is_empty());
        assert!(demuxer.take_responses().is_empty(), "draining must clear the queue");
    }

    #[test]
    fn a_query_split_across_reads_is_still_answered() {
        let mut demuxer = StreamDemuxer::new();
        demuxer.process_bytes(b"\x1b]11");
        demuxer.process_bytes(b";?\x1b\\");
        assert!(
            !demuxer.take_responses().is_empty(),
            "a probe that straddles a read boundary must still get an answer"
        );
    }

    #[test]
    fn ordinary_traffic_produces_no_responses() {
        let mut demuxer = StreamDemuxer::new();
        demuxer.process_bytes(b"\x1b]133;A\x07$ ls\r\n\x1b[0mfile.txt\r\n");
        assert!(
            demuxer.take_responses().is_empty(),
            "we must only answer real queries, never chatter at the shell"
        );
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
