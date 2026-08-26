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
}

pub struct StreamDemuxer {
    in_osc: bool,
    osc_buf: Vec<u8>,
    in_csi: bool,
    csi_buf: Vec<u8>,
    tui_active: bool,
}

impl StreamDemuxer {
    pub fn new() -> Self {
        Self {
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

                if is_bel || is_st {
                    self.in_osc = false;
                    let osc_slice = if is_st {
                        &self.osc_buf[..self.osc_buf.len().saturating_sub(2)]
                    } else {
                        &self.osc_buf[..self.osc_buf.len().saturating_sub(1)]
                    };

                    if let Ok(osc_str) = std::str::from_utf8(osc_slice) {
                        if let Some(event) = self.parse_osc_133(osc_str) {
                            if !output_chunk.is_empty() {
                                events.push(DemuxEvent::Output {
                                    data: String::from_utf8_lossy(&output_chunk).to_string(),
                                });
                                output_chunk.clear();
                            }
                            events.push(event);
                        } else {
                            output_chunk.extend_from_slice(&self.osc_buf);
                        }
                    } else {
                        output_chunk.extend_from_slice(&self.osc_buf);
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

            if b == 0x1b && i + 1 < bytes.len() {
                let next = bytes[i + 1];
                if next == b']' {
                    self.in_osc = true;
                    self.osc_buf.clear();
                    self.osc_buf.push(0x1b);
                    self.osc_buf.push(b']');
                    i += 2;
                    continue;
                } else if next == b'[' {
                    self.in_csi = true;
                    self.csi_buf.clear();
                    i += 2;
                    continue;
                }
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

    fn parse_osc_133(&self, osc_content: &str) -> Option<DemuxEvent> {
        let trimmed = osc_content.trim_start_matches("\x1b]").trim();
        if !trimmed.starts_with("133;") {
            return None;
        }

        let parts: Vec<&str> = trimmed.split(';').collect();
        if parts.len() < 2 {
            return None;
        }

        match parts[1] {
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
        }
    }
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

