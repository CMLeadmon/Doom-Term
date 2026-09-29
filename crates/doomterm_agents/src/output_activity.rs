//! When a terminal last produced output, kept in short time buckets.
//!
//! Agent CLIs repaint their idle footers on a timer, so "output arrived recently" flags an idle
//! agent as busy forever. Real work streams output continuously; a footer repaint is a single
//! burst. [`OutputActivity::is_continuous`] therefore asks whether most of the last few buckets
//! saw output, which a periodic repaint can never satisfy.

use std::sync::atomic::{AtomicU64, Ordering};

use instant::Instant;

const BUCKET_MS: u64 = 200;
/// Buckets inspected by the continuity test, including the current one.
const WINDOW: u64 = 5;
/// Buckets within the window that must have seen output.
const THRESHOLD: usize = 3;
const SLOTS: usize = 8;

/// Written by the PTY reader thread, read by the UI thread; never takes the terminal lock.
#[derive(Debug)]
pub struct OutputActivity {
    epoch: Instant,
    /// Each slot holds the (1-based) bucket number that last wrote to it; 0 means never.
    slots: [AtomicU64; SLOTS],
}

impl Default for OutputActivity {
    fn default() -> Self {
        Self::new(Instant::now())
    }
}

impl OutputActivity {
    pub fn new(epoch: Instant) -> Self {
        Self {
            epoch,
            slots: Default::default(),
        }
    }

    fn bucket(&self, at: Instant) -> u64 {
        at.saturating_duration_since(self.epoch).as_millis() as u64 / BUCKET_MS + 1
    }

    pub fn record(&self) {
        self.record_at(Instant::now());
    }

    pub fn record_at(&self, at: Instant) {
        let bucket = self.bucket(at);
        self.slots[bucket as usize % SLOTS].store(bucket, Ordering::Relaxed);
    }

    pub fn is_continuous(&self) -> bool {
        self.is_continuous_at(Instant::now())
    }

    pub fn is_continuous_at(&self, now: Instant) -> bool {
        let current = self.bucket(now);
        (0..WINDOW)
            .filter_map(|back| current.checked_sub(back).filter(|b| *b > 0))
            .filter(|b| self.slots[*b as usize % SLOTS].load(Ordering::Relaxed) == *b)
            .count()
            >= THRESHOLD
    }
}

#[cfg(test)]
#[path = "output_activity_tests.rs"]
mod tests;
