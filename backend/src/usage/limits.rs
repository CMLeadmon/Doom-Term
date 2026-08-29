//! Pure mapping of Anthropic's `/api/oauth/usage` payload into the single
//! fraction the plate's USAGE slot renders.
//!
//! No fs, no network — every impure step lives in `service.rs`. The payload
//! carries the same facts twice: a generic `limits[]` array (current) and a set
//! of fixed top-level windows (legacy). We prefer the array and treat the model
//! name as DATA, never as a field name, so a new model's quota arrives as
//! another array entry and this file does not change.

use serde_json::Value;

/// One rate-limit window the account is subject to.
#[derive(Debug, Clone, PartialEq)]
pub struct UsageLimit {
    pub kind: String,
    /// Portion USED, 0..100 — matching the wire, so a reader comparing this
    /// file to the payload is not also doing arithmetic in their head.
    pub used_percent: f64,
    /// Is this the window currently gating requests? Absent on the wire means
    /// UNKNOWN, not inactive — an older payload that omits the field must not
    /// have every limit silently treated as dormant.
    pub is_active: bool,
}

/// `percent`/`utilization` are portions used, 0–100. Clamp: the server is not
/// our validator, and a 140% window must not render as 140%.
fn clamp_percent(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.clamp(0.0, 100.0))
}

fn map_limit(raw: &Value) -> Option<UsageLimit> {
    let kind = raw.get("kind")?.as_str()?;
    if kind.is_empty() {
        return None;
    }
    let used_percent = clamp_percent(raw.get("percent"))?;
    Some(UsageLimit {
        kind: kind.to_string(),
        used_percent,
        is_active: raw.get("is_active").and_then(Value::as_bool) == Some(true),
    })
}

/// Reconstruct the two windows older payloads ever populated. The per-model
/// top-level fields are dead in current responses and are deliberately not
/// resurrected here.
fn legacy_limits(body: &Value) -> Vec<UsageLimit> {
    let mut out = Vec::new();
    for (field, kind) in [("five_hour", "session"), ("seven_day", "weekly_all")] {
        let Some(w) = body.get(field) else { continue };
        let used = clamp_percent(w.get("utilization").or_else(|| w.get("used_percentage")));
        if let Some(used_percent) = used {
            out.push(UsageLimit {
                kind: kind.to_string(),
                used_percent,
                is_active: false,
            });
        }
    }
    out
}

/// Normalize a raw `/api/oauth/usage` body into the limit list.
pub fn map_limits(body: &Value) -> Vec<UsageLimit> {
    if let Some(arr) = body.get("limits").and_then(Value::as_array) {
        let mapped: Vec<UsageLimit> = arr.iter().filter_map(map_limit).collect();
        if !mapped.is_empty() {
            return mapped;
        }
    }
    legacy_limits(body)
}

/// The one number the plate shows, as a 0..1 fraction.
///
/// The plate has a single USAGE slot, so it must pick one of several windows.
/// A window the server flagged `is_active` is the one currently gating
/// requests and wins outright; otherwise the WORST window wins, because that is
/// the constraint about to cut the account off. An empty list is not 0% — an
/// account on API-key billing has no subscription window at all — so it reports
/// nothing and the slot stays '--'.
pub fn reportable_fraction(limits: &[UsageLimit]) -> Option<f64> {
    let pick = limits.iter().find(|l| l.is_active).or_else(|| {
        limits
            .iter()
            .max_by(|a, b| a.used_percent.total_cmp(&b.used_percent))
    })?;
    Some(pick.used_percent / 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_the_current_limits_array() {
        let body = json!({
            "limits": [
                { "kind": "session", "percent": 12.5, "is_active": true },
                { "kind": "weekly_all", "percent": 40.0, "is_active": false }
            ]
        });
        let limits = map_limits(&body);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].kind, "session");
        assert_eq!(limits[0].used_percent, 12.5);
        assert!(limits[0].is_active);
    }

    #[test]
    fn clamps_out_of_range_percentages() {
        // The server is not our validator.
        let body = json!({ "limits": [ { "kind": "session", "percent": 140.0 } ] });
        assert_eq!(map_limits(&body)[0].used_percent, 100.0);
        let body = json!({ "limits": [ { "kind": "session", "percent": -5.0 } ] });
        assert_eq!(map_limits(&body)[0].used_percent, 0.0);
    }

    #[test]
    fn skips_entries_with_no_usable_percentage() {
        let body = json!({
            "limits": [
                { "kind": "session" },
                { "percent": 10.0 },
                { "kind": "weekly_all", "percent": 10.0 }
            ]
        });
        // No percent, and no kind, are both unusable; only the third survives.
        assert_eq!(map_limits(&body).len(), 1);
    }

    #[test]
    fn absent_is_active_means_unknown_not_active() {
        let body = json!({ "limits": [ { "kind": "session", "percent": 10.0 } ] });
        assert!(!map_limits(&body)[0].is_active);
    }

    #[test]
    fn falls_back_to_the_legacy_fixed_windows() {
        let body = json!({
            "five_hour": { "utilization": 30.0 },
            "seven_day": { "utilization": 55.0 }
        });
        let limits = map_limits(&body);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].kind, "session");
        assert_eq!(limits[1].used_percent, 55.0);
    }

    #[test]
    fn prefers_the_limits_array_over_legacy_fields() {
        let body = json!({
            "limits": [ { "kind": "session", "percent": 7.0 } ],
            "five_hour": { "utilization": 99.0 }
        });
        assert_eq!(map_limits(&body).len(), 1);
        assert_eq!(map_limits(&body)[0].used_percent, 7.0);
    }

    #[test]
    fn reports_the_active_limit_when_one_is_flagged() {
        let limits = vec![
            UsageLimit {
                kind: "session".into(),
                used_percent: 20.0,
                is_active: true,
            },
            UsageLimit {
                kind: "weekly_all".into(),
                used_percent: 80.0,
                is_active: false,
            },
        ];
        // The flagged window is the one currently gating requests.
        assert_eq!(reportable_fraction(&limits), Some(0.2));
    }

    #[test]
    fn reports_the_worst_limit_when_none_is_flagged() {
        let limits = vec![
            UsageLimit {
                kind: "session".into(),
                used_percent: 20.0,
                is_active: false,
            },
            UsageLimit {
                kind: "weekly_all".into(),
                used_percent: 80.0,
                is_active: false,
            },
        ];
        // One slot on the plate, so it shows the constraint about to bite.
        assert_eq!(reportable_fraction(&limits), Some(0.8));
    }

    #[test]
    fn reports_nothing_for_an_empty_limit_list() {
        // An account on API-key billing has no subscription window. That is
        // '--', not 0%.
        assert_eq!(reportable_fraction(&[]), None);
    }

    #[test]
    fn reports_nothing_for_a_body_that_is_not_a_usage_payload() {
        assert_eq!(map_limits(&json!({ "error": "nope" })).len(), 0);
        assert_eq!(map_limits(&json!("captive portal")).len(), 0);
    }
}
