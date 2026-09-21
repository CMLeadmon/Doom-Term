use super::*;

/// Drive the fetch closure of an [`AssetSource::Async`] to completion.
fn fetch_bytes(source: &AssetSource) -> Result<Bytes> {
    match source {
        AssetSource::Async { fetch, .. } => futures::executor::block_on(fetch()),
        other => panic!("expected an Async source, got {other:?}"),
    }
}

#[test]
fn data_uri_source_decodes_base64_payload() {
    let source = data_uri_source("data:image/png;base64,iVBORw0KGgo=")
        .expect("base64 data URI should produce a source");
    let bytes = fetch_bytes(&source).expect("payload should decode");
    assert_eq!(
        bytes.as_ref(),
        BASE64_STANDARD.decode("iVBORw0KGgo=").unwrap().as_slice()
    );
}

#[test]
fn data_uri_source_strips_embedded_whitespace() {
    // base64 payloads saved in notebooks frequently contain newlines.
    let source =
        data_uri_source("data:image/png;base64,iVBO\nRw0K Ggo=").expect("should produce a source");
    let bytes = fetch_bytes(&source).expect("payload should decode after stripping whitespace");
    assert_eq!(
        bytes.as_ref(),
        BASE64_STANDARD.decode("iVBORw0KGgo=").unwrap().as_slice()
    );
}

#[test]
fn data_uri_source_rejects_non_base64_data_uris() {
    assert!(data_uri_source("https://example.com/a.png").is_none());
    assert!(data_uri_source("/abs/path.png").is_none());
    assert!(data_uri_source("relative/path.png").is_none());
    // A `data:` URI without the `;base64` marker is not a renderable asset.
    assert!(data_uri_source("data:text/plain,hello").is_none());
    // A `data:` URI without a comma separator is malformed.
    assert!(data_uri_source("data:image/png;base64").is_none());
}

#[test]
fn data_uri_source_invalid_base64_fails_on_fetch() {
    // Detection succeeds on the prefix/marker, but decoding the bad payload
    // surfaces as a fetch error (FailedToLoad) rather than a panic.
    let source =
        data_uri_source("data:image/png;base64,not valid base64!").expect("detected as data URI");
    assert!(fetch_bytes(&source).is_err());
}

#[test]
fn data_uri_source_rejects_oversized_payload() {
    // An untrusted, oversized payload must be rejected before it is cloned or
    // decoded, so it never produces an asset source.
    let huge = "A".repeat(MAX_DATA_URI_PAYLOAD_BYTES + 1);
    let source = format!("data:image/png;base64,{huge}");
    assert!(data_uri_source(&source).is_none());
}

#[test]
fn data_uri_exceeds_limit_flags_only_oversized_base64_payloads() {
    let huge = "A".repeat(MAX_DATA_URI_PAYLOAD_BYTES + 1);
    assert!(data_uri_exceeds_limit(&format!(
        "data:image/png;base64,{huge}"
    )));

    // In-limit payloads, non-base64 `data:` URIs, and non-`data:` sources are
    // not flagged as oversized.
    assert!(!data_uri_exceeds_limit(
        "data:image/png;base64,iVBORw0KGgo="
    ));
    assert!(!data_uri_exceeds_limit(&format!("data:text/plain,{huge}")));
    assert!(!data_uri_exceeds_limit("https://example.com/a.png"));
    assert!(!data_uri_exceeds_limit("relative/path.png"));
}

#[cfg(not(feature = "remote-fetch"))]
#[test]
fn local_only_rejects_remote_assets_before_connecting() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let source = url_source(format!(
        "http://{}/asset.png",
        listener.local_addr().unwrap()
    ));
    let AssetSource::Async { fetch, .. } = source else {
        panic!("expected async source")
    };
    let mut fetch = fetch();
    // A disabled transport resolves immediately, without a socket or runtime.
    use std::task::{Context, Poll, Waker};
    let Poll::Ready(Err(error)) = fetch.as_mut().poll(&mut Context::from_waker(Waker::noop()))
    else {
        panic!("local-only remote asset rejection must be immediate");
    };
    assert_eq!(error.to_string(), "Remote asset fetching is disabled");
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

#[cfg(not(feature = "remote-fetch"))]
#[test]
fn local_only_rejects_remote_assets_even_when_cached() {
    let dir = tempfile::tempdir().unwrap();
    let url = Url::parse("https://example.com/image.png").unwrap();
    std::fs::write(
        get_file_path_for_asset(&url, dir.path()),
        b"cached remote data",
    )
    .unwrap();
    let source = url_source_with_persistence(url.as_str(), dir.path());
    assert_eq!(
        fetch_bytes(&source).unwrap_err().to_string(),
        "Remote asset fetching is disabled"
    );
}

#[cfg(not(feature = "remote-fetch"))]
#[test]
fn local_only_reads_file_assets() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("local asset.bin");
    std::fs::write(&path, b"local asset").unwrap();
    let source = url_source(Url::from_file_path(path).unwrap());
    assert_eq!(fetch_bytes(&source).unwrap().as_ref(), b"local asset");
}
