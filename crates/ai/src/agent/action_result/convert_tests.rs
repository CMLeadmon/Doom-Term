use super::*;

#[test]
fn mcp_tool_result_preserves_supported_content_from_the_wire() {
    let result = serde_json::from_value(serde_json::json!({
        "content": [
            {"type": "text", "text": "tool output"},
            {"type": "image", "data": "aW1hZ2U=", "mimeType": "image/png"},
            {"type": "resource", "resource": {
                "uri": "file:///text", "text": "resource output", "mimeType": "text/plain"
            }},
            {"type": "resource", "resource": {
                "uri": "file:///binary", "blob": "YmluYXJ5", "mimeType": "application/octet-stream"
            }},
            {"type": "audio", "data": "YXVkaW8=", "mimeType": "audio/wav"},
            {"type": "resource_link", "uri": "file:///link", "name": "link"}
        ]
    }))
    .unwrap();
    let result = api::request::input::tool_call_result::Result::try_from(
        CallMCPToolResult::Success { result },
    )
    .unwrap();
    let api::request::input::tool_call_result::Result::CallMcpTool(result) = result else {
        panic!("expected MCP tool result");
    };
    let Some(api::call_mcp_tool_result::Result::Success(success)) = result.result else {
        panic!("expected successful MCP tool result");
    };
    use api::call_mcp_tool_result::success::result::Result;
    assert_eq!(success.results.len(), 4);
    let Some(Result::Text(text)) = &success.results[0].result else {
        panic!("expected text content");
    };
    assert_eq!(text.text, "tool output");
    let Some(Result::Image(image)) = &success.results[1].result else {
        panic!("expected image content");
    };
    assert_eq!(image.data, b"aW1hZ2U=");
    assert_eq!(image.mime_type, "image/png");
    let Some(Result::Resource(text_resource)) = &success.results[2].result else {
        panic!("expected text resource");
    };
    assert_eq!(text_resource.uri, "file:///text");
    let Some(api::mcp_resource_content::ContentType::Text(text)) = &text_resource.content_type else {
        panic!("expected resource text");
    };
    assert_eq!(text.content, "resource output");
    assert_eq!(text.mime_type, "text/plain");
    let Some(Result::Resource(binary_resource)) = &success.results[3].result else {
        panic!("expected binary resource");
    };
    assert_eq!(binary_resource.uri, "file:///binary");
    let Some(api::mcp_resource_content::ContentType::Binary(binary)) = &binary_resource.content_type
    else {
        panic!("expected resource binary data");
    };
    assert_eq!(binary.data, b"YmluYXJ5");
    assert_eq!(binary.mime_type, "application/octet-stream");
}

#[test]
fn mcp_tool_result_preserves_structured_errors_from_the_wire() {
    let result = serde_json::from_value(serde_json::json!({
        "content": [{"type": "text", "text": "fallback"}],
        "structuredContent": {"reason": "permission denied"},
        "isError": true
    }))
    .unwrap();
    let result = api::request::input::tool_call_result::Result::try_from(
        CallMCPToolResult::Success { result },
    )
    .unwrap();
    let api::request::input::tool_call_result::Result::CallMcpTool(result) = result else {
        panic!("expected MCP tool result");
    };
    let Some(api::call_mcp_tool_result::Result::Error(error)) = result.result else {
        panic!("expected MCP tool error");
    };
    assert_eq!(error.message, r#"{"reason":"permission denied"}"#);
}

#[test]
fn read_files_partial_success_converts_failed_files() {
    let result =
        api::request::input::tool_call_result::Result::try_from(ReadFilesResult::Success {
            files: vec![FileContext::new(
                "/tmp/success.txt".to_string(),
                AnyFileContent::StringContent("hello".to_string()),
                None,
                None,
            )],
            failed_files: vec![ReadFilesFailedFile {
                path: "/tmp/missing.txt".to_string(),
                message: "File not found or could not be read".to_string(),
            }],
        })
        .expect("read_files success should convert");

    let api::request::input::tool_call_result::Result::ReadFiles(result) = result else {
        panic!("expected read_files result");
    };

    let Some(api::read_files_result::Result::AnyFilesSuccess(success)) = result.result else {
        panic!("expected any files success result");
    };

    assert_eq!(success.files.len(), 1);
    assert_eq!(success.failed_reads.len(), 1);
    assert_eq!(success.failed_reads[0].path, "/tmp/missing.txt");
    assert_eq!(
        success.failed_reads[0].message,
        "File not found or could not be read"
    );
}

#[test]
fn ask_user_question_skipped_by_auto_approve_converts_to_skipped_answers() {
    let result = api::request::input::tool_call_result::Result::from(
        AskUserQuestionResult::SkippedByAutoApprove {
            question_ids: vec!["q1".to_string(), "q2".to_string()],
        },
    );

    let api::request::input::tool_call_result::Result::AskUserQuestion(result) = result else {
        panic!("expected ask_user_question result");
    };

    let Some(api::ask_user_question_result::Result::Success(success)) = result.result else {
        panic!("expected success result");
    };

    assert_eq!(success.answers.len(), 2);
    assert_eq!(success.answers[0].question_id, "q1");
    assert_eq!(success.answers[1].question_id, "q2");
    assert!(matches!(
        success.answers[0].answer,
        Some(AskUserQuestionAnswer::Skipped(()))
    ));
    assert!(matches!(
        success.answers[1].answer,
        Some(AskUserQuestionAnswer::Skipped(()))
    ));
}
