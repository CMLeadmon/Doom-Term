use super::*;

fn solid(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
    (0..width * height)
        .flat_map(|_| [rgb[0], rgb[1], rgb[2], 255])
        .collect()
}

#[test]
fn round_trip_is_lossless() {
    let mut second = solid(8, 8, [10, 20, 30]);
    second[0..4].copy_from_slice(&[200, 100, 50, 255]);
    let frames = vec![solid(8, 8, [1, 2, 3]), second];
    let bytes = encode_gif(&frames, 8, 8, 8).unwrap();
    let decoded = decode_gif(&bytes).unwrap();
    assert_eq!((decoded.width, decoded.height), (8, 8));
    assert_eq!(decoded.frames, frames);
    assert_eq!(decoded.delays_cs, vec![8, 8]);
}

#[test]
fn the_gif_loops_forever() {
    let bytes = encode_gif(&[solid(4, 4, [9, 9, 9])], 4, 4, 8).unwrap();
    assert!(bytes.windows(11).any(|w| w == b"NETSCAPE2.0"));
}

#[test]
fn more_than_256_colours_is_an_error_not_a_downgrade() {
    let frame: Vec<u8> = (0..300_u32)
        .flat_map(|i| [(i % 256) as u8, (i / 256) as u8, 7, 255])
        .collect();
    let err = encode_gif(&[frame], 20, 15, 8).unwrap_err();
    assert!(
        matches!(err, GifError::TooManyColours { frame: 0 }),
        "{err}"
    );
}

#[test]
fn a_buffer_of_the_wrong_size_is_rejected() {
    let err = encode_gif(&[vec![0; 10]], 4, 4, 8).unwrap_err();
    assert!(matches!(err, GifError::SizeMismatch { frame: 0 }), "{err}");
}

#[test]
fn garbage_is_a_decode_error() {
    assert!(matches!(decode_gif(b"not a gif"), Err(GifError::Decode(_))));
}
