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
    buffer: Vec<u8>,
    in_osc: bool,
    osc_buf: Vec<u8>,
    in_csi: bool,
    csi_buf: Vec<u8>,
    tui_active: bool,
}

impl StreamDemuxer {
    pub fn new() -> Self {
        Self {
            buffer: Vec::with_capacity(4096),
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
                // Check for ST (String Terminator: \x1b\ or \x07 BEL)
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
                            // Non-133 OSC, retain in output
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
                // CSI parameter/intermediate characters are 0x20..=0x3F, final bytes are 0x40..=0x7E
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
                    // Write the CSI sequence through so terminal renderers also get it
                    output_chunk.push(0x1b);
                    output_chunk.push(b'[');
                    output_chunk.extend_from_slice(&self.csi_buf);
                    self.csi_buf.clear();
                }
                i += 1;
                continue;
            }

            // Check start of escape sequence
            if b == 0x1b && i + 1 < bytes.len() {
                let next = bytes[i + 1];
                if next == b']' {
                    // OSC start
                    self.in_osc = true;
                    self.osc_buf.clear();
                    self.osc_buf.push(0x1b);
                    self.osc_buf.push(b']');
                    i += 2;
                    continue;
                } else if next == b'[' {
                    // CSI start
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
        // OSC 133 sequences look like: "133;A" or "\x1b]133;A"
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
