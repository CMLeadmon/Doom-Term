use super::*;

#[test]
fn hash_is_deterministic_and_in_unit_range() {
    for x in -40..40 {
        for y in -40..40 {
            let value = hash(x, y, 7);
            assert_eq!(value, hash(x, y, 7));
            assert!((0.0..1.0).contains(&value), "hash({x}, {y}) = {value}");
        }
    }
}

#[test]
fn hash_depends_on_every_argument() {
    assert_ne!(hash(1, 2, 3), hash(2, 2, 3));
    assert_ne!(hash(1, 2, 3), hash(1, 3, 3));
    assert_ne!(hash(1, 2, 3), hash(1, 2, 4));
}

#[test]
fn fbm_repeats_after_one_period_on_both_axes() {
    for i in 0..40 {
        let (x, y) = (f64::from(i) * 0.37, f64::from(i) * 0.91);
        let base = fbm(x, y, 6, 3, 11, 4);
        assert!((base - fbm(x + 6.0, y, 6, 3, 11, 4)).abs() < 1e-9);
        assert!((base - fbm(x, y + 3.0, 6, 3, 11, 4)).abs() < 1e-9);
    }
}

#[test]
fn fbm_stays_in_unit_range() {
    for i in 0..200 {
        let value = fbm(f64::from(i) * 0.13, f64::from(i) * 0.29, 5, 5, 3, 4);
        assert!((0.0..=1.0).contains(&value), "fbm = {value}");
    }
}

#[test]
fn smooth_clamps_and_is_monotonic() {
    assert_eq!(smooth(-1.0), 0.0);
    assert_eq!(smooth(2.0), 1.0);
    assert!(smooth(0.25) < smooth(0.75));
}
