use super::*;

#[test]
fn a_pane_shows_the_name_its_user_gave_it() {
    assert_eq!(
        pane_name(Some("  deploy notes "), "user@host: ~/src"),
        Some("deploy notes".into())
    );
}

#[test]
fn an_unnamed_pane_shows_its_title() {
    assert_eq!(pane_name(None, " ~/src/app "), Some("~/src/app".into()));
    assert_eq!(pane_name(Some("   "), "build"), Some("build".into()));
}

#[test]
fn a_pane_with_no_name_and_no_title_has_no_name() {
    assert_eq!(pane_name(None, ""), None);
    assert_eq!(pane_name(Some(" "), "  "), None);
}
