//! The pack's contract: the keys Doom Term's theme loader needs, the values the design fixes,
//! and the files the YAML points at.

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Deserialize)]
struct Pack {
    name: String,
    background: String,
    foreground: String,
    accent: String,
    cursor: String,
    details: String,
    terminal_colors: TerminalColors,
    background_image: BackgroundImage,
    plate_stone: String,
}

#[derive(Deserialize)]
struct TerminalColors {
    normal: Ansi,
    bright: Ansi,
}

#[derive(Deserialize)]
struct Ansi {
    black: String,
    red: String,
    green: String,
    yellow: String,
    blue: String,
    magenta: String,
    cyan: String,
    white: String,
}

impl Ansi {
    fn all(&self) -> [&str; 8] {
        [
            &self.black,
            &self.red,
            &self.green,
            &self.yellow,
            &self.blue,
            &self.magenta,
            &self.cyan,
            &self.white,
        ]
    }
}

#[derive(Deserialize)]
struct BackgroundImage {
    path: String,
    opacity: u8,
}

fn themes_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../themes")
}

fn load() -> Pack {
    let text = fs::read_to_string(themes_dir().join("redsky/redsky.yaml")).expect("redsky.yaml");
    serde_yaml::from_str(&text).expect("redsky.yaml parses")
}

fn is_hex(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..]
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn luminance(color: &str) -> f64 {
    let channel = |range: std::ops::Range<usize>| {
        let value = f64::from(u8::from_str_radix(&color[range], 16).unwrap()) / 255.0;
        if value <= 0.03928 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(1..3) + 0.7152 * channel(3..5) + 0.0722 * channel(5..7)
}

#[test]
fn the_pack_is_named_redsky_and_ships_at_the_agreed_opacity() {
    let pack = load();
    assert_eq!(pack.name, "Redsky");
    assert_eq!(pack.details, "darker");
    assert_eq!(pack.background_image.opacity, 10);
}

#[test]
fn every_colour_is_a_lowercase_hex_triplet() {
    let pack = load();
    let mut colours = vec![
        pack.background.as_str(),
        pack.foreground.as_str(),
        pack.accent.as_str(),
        pack.cursor.as_str(),
        pack.plate_stone.as_str(),
    ];
    colours.extend(pack.terminal_colors.normal.all());
    colours.extend(pack.terminal_colors.bright.all());
    for colour in colours {
        assert!(is_hex(colour), "not a lowercase #rrggbb colour: {colour}");
    }
}

#[test]
fn the_foreground_reads_on_the_background() {
    let pack = load();
    let (a, b) = (luminance(&pack.foreground), luminance(&pack.background));
    assert!((a + 0.05) / (b + 0.05) >= 7.0);
}

#[test]
fn the_image_path_resolves_under_the_themes_folder() {
    let pack = load();
    assert_eq!(pack.background_image.path, "redsky/redsky.gif");
    assert!(themes_dir().join(&pack.background_image.path).is_file());
}

#[test]
fn the_plate_stone_key_is_the_agreed_value() {
    assert_eq!(load().plate_stone, "#49121f");
}

#[test]
fn the_pack_folder_holds_only_the_shipped_files() {
    let mut names: Vec<String> = fs::read_dir(themes_dir().join("redsky"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["README.txt", "redsky.gif", "redsky.yaml"]);
}

#[test]
fn the_pack_text_uses_no_game_vocabulary() {
    let text = ["redsky/redsky.yaml", "redsky/README.txt"]
        .iter()
        .map(|file| {
            fs::read_to_string(themes_dir().join(file))
                .unwrap()
                .to_lowercase()
        })
        .collect::<String>();
    for word in ["ammo", "armor", "e1m1", "god mode", "phobos", "doomguy"] {
        assert!(!text.contains(word), "pack text contains {word:?}");
    }
}
