//! Presentation state observed and displayed by the status plate.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WaitingSession {
    pub session_id: String,
    pub n: String,
    pub name: String,
    pub status: String,
    pub tag: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TokenRow {
    pub label: String,
    pub cur: String,
    pub lim: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlateState {
    pub context: Option<f32>,
    pub usage: Option<f32>,
    pub agent: String,
    pub agent_name: String,
    pub path: String,
    pub branch: String,
    pub mode: String,
    pub chips: [bool; 6],
    pub table: Vec<TokenRow>,
    pub waiting: Vec<WaitingSession>,
    pub phase: f32,
    pub is_busy: bool,
}

impl Default for PlateState {
    fn default() -> Self {
        Self {
            context: None,
            usage: None,
            agent: "unknown".into(),
            agent_name: "--".into(),
            path: "--".into(),
            branch: "--".into(),
            mode: "FULL".into(),
            chips: [false; 6],
            table: Vec::new(),
            waiting: Vec::new(),
            phase: 0.0,
            is_busy: false,
        }
    }
}
