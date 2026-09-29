use super::*;

#[test]
fn valid_report_uses_only_bounded_fractions_and_explicit_working_state() {
    let report = parse_report(br#"{"context":0.25,"usage":0.7,"working":true}"#).unwrap();
    assert_eq!(report.context, Some(0.25));
    assert_eq!(report.usage, Some(0.7));
    assert_eq!(report.working, Some(true));
}

#[test]
fn invalid_or_untrusted_values_are_unknown() {
    assert!(parse_report(br#"{"context":2,"usage":-1,"working":"yes"}"#).is_none());
    assert!(parse_report(br#"{"context":0.5,"usage":null,"working":null}"#).is_some());
    assert!(parse_report(b"not json").is_none());
    assert!(parse_report(&vec![b'x'; 4097]).is_none());
}

#[test]
fn cwd_transport_contains_only_hex_even_for_shell_metacharacters() {
    let cwd = "/project/it's $(touch /tmp/bad); 🦀";
    let encoded = encode_cwd(cwd);
    assert!(encoded.starts_with("2f70726f6a6563742f"));
    assert_eq!(encoded.len(), cwd.len() * 2);
    assert!(encoded.bytes().all(|byte| byte.is_ascii_hexdigit()));
}
