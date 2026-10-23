use crate::gateway::agent::messages::AgentMessage;

pub const DEFAULT_PRUNE_THRESHOLD_CHARS: usize = 8192;
pub const DEFAULT_PRUNE_HEAD_CHARS: usize = 4096;
pub const DEFAULT_PRUNE_TAIL_CHARS: usize = 1024;

/// 对齐 DSH compaction-tool-result-pruner 规范：
/// 当工具结果纯文本字符数超过阈值时，保留头部与尾部，中间替换为无损说明标记。
pub fn prune_tool_result_content(
    content: &str,
    threshold_chars: usize,
    head_chars: usize,
    tail_chars: usize,
) -> Option<String> {
    let char_count = content.chars().count();
    if char_count <= threshold_chars {
        return None;
    }

    if head_chars + tail_chars >= char_count {
        return None;
    }

    // 按字符迭代定位 byte offset
    let mut head_end_byte = 0;
    for (i, (byte_idx, _)) in content.char_indices().enumerate() {
        if i == head_chars {
            head_end_byte = byte_idx;
            break;
        }
    }

    let tail_start_char_idx = char_count - tail_chars;
    let mut tail_start_byte = content.len();
    for (i, (byte_idx, _)) in content.char_indices().enumerate() {
        if i == tail_start_char_idx {
            tail_start_byte = byte_idx;
            break;
        }
    }

    let head = &content[..head_end_byte];
    let tail = &content[tail_start_byte..];
    let omitted_chars = char_count - head_chars - tail_chars;

    Some(format!(
        "{}\n\n[... 工具输出过长，已省略中间 {} 字符以节省上下文 ...]\n\n{}",
        head, omitted_chars, tail
    ))
}

/// 判定是否属于只读探查类的工具名称，可以安全在多轮历史轮次中执行微压缩
pub fn is_readonly_inspection_tool(name: &str) -> bool {
    matches!(
        name,
        "read_file"
            | "list_directory"
            | "glob"
            | "grep"
            | "git_status"
            | "git_diff"
            | "web_fetch"
            | "web_search"
    )
}

/// 对齐 Claude Code 微压缩（Micro-Compaction）与修剪规范：
/// 1. 保护最近活跃轮次（倒数 1~2 个 Assistant 之后的新鲜工具结果）的完整性与细节；
/// 2. 对更早历史轮次中的长只读工具输出执行微压缩（Micro-Compaction），折叠为语义摘要标记，防止上下文膨胀；
/// 3. 错误信息与写入动作始终完整保留，供模型推理参考。
pub fn prune_agent_messages(
    messages: &[AgentMessage],
    threshold_chars: usize,
    head_chars: usize,
    tail_chars: usize,
) -> Vec<AgentMessage> {
    let assistant_indices: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter_map(|(idx, msg)| match msg {
            AgentMessage::Assistant { .. } => Some(idx),
            _ => None,
        })
        .collect();

    // 倒数第 2 个 Assistant 之后的消息属于近期活跃轮次，更早的消息属于历史轮次
    let active_boundary_index = if assistant_indices.len() >= 2 {
        assistant_indices[assistant_indices.len() - 2]
    } else {
        0
    };

    const HISTORICAL_MICRO_COMPACT_THRESHOLD: usize = 300;

    messages
        .iter()
        .enumerate()
        .map(|(idx, msg)| match msg {
            AgentMessage::ToolResult {
                tool_call_id,
                name,
                content,
            } => {
                let char_count = content.chars().count();
                let is_historical = idx < active_boundary_index;
                let is_error_like = content.starts_with("Error")
                    || content.starts_with("Failed")
                    || content.starts_with("错误")
                    || content.starts_with("Access denied");

                if is_historical
                    && is_readonly_inspection_tool(name)
                    && !is_error_like
                    && char_count > HISTORICAL_MICRO_COMPACT_THRESHOLD
                {
                    let compacted = format!(
                        "[历史工具输出微压缩: 工具 '{}' 执行完成 (原始约 {} 字符)。历史细节已折叠以优化上下文，若需最新内容请再次调用该工具]",
                        name, char_count
                    );
                    AgentMessage::ToolResult {
                        tool_call_id: tool_call_id.clone(),
                        name: name.clone(),
                        content: compacted,
                    }
                } else {
                    let pruned = prune_tool_result_content(
                        content,
                        threshold_chars,
                        head_chars,
                        tail_chars,
                    );
                    AgentMessage::ToolResult {
                        tool_call_id: tool_call_id.clone(),
                        name: name.clone(),
                        content: pruned.unwrap_or_else(|| content.clone()),
                    }
                }
            }
            other => other.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prune_under_threshold() {
        let content = "short content";
        assert_eq!(
            prune_tool_result_content(content, 100, 20, 10),
            None
        );
    }

    #[test]
    fn test_prune_over_threshold() {
        let content = "A".repeat(100);
        let pruned = prune_tool_result_content(&content, 50, 10, 5).unwrap();
        assert!(pruned.starts_with("AAAAAAAAAA\n\n[... 工具输出过长，已省略中间 85 字符以节省上下文 ...]\n\nAAAAA"));
    }

    #[test]
    fn test_prune_utf8_multibyte() {
        // 中文字符每个 3 字节
        let chinese = "星".repeat(100);
        let pruned = prune_tool_result_content(&chinese, 50, 10, 5).unwrap();
        assert!(pruned.starts_with("星星星星星星星星星星\n\n[... 工具输出过长，已省略中间 85 字符以节省上下文 ...]\n\n星星星星星"));
    }

    #[test]
    fn test_prune_agent_messages_preserves_user_and_assistant() {
        let msgs = vec![
            AgentMessage::User {
                text: "hello".to_string(),
                image_data_url: None,
            },
            AgentMessage::ToolResult {
                tool_call_id: "call_1".to_string(),
                name: "read_file".to_string(),
                content: "x".repeat(100),
            },
        ];
        let pruned = prune_agent_messages(&msgs, 50, 10, 5);
        assert_eq!(pruned.len(), 2);
        match &pruned[0] {
            AgentMessage::User { text, .. } => assert_eq!(text, "hello"),
            _ => panic!("Expected User"),
        }
        match &pruned[1] {
            AgentMessage::ToolResult { content, .. } => {
                assert!(content.contains("[... 工具输出过长"));
            }
            _ => panic!("Expected ToolResult"),
        }
    }

    #[test]
    fn test_micro_compaction_folds_older_readonly_tool_results() {
        use crate::types::ToolInvocation;

        let msgs = vec![
            AgentMessage::User { text: "第一步".to_string(), image_data_url: None },
            AgentMessage::Assistant {
                text: "读文件".to_string(),
                reasoning: String::new(),
                tool_calls: vec![ToolInvocation { id: "c1".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({}) }],
                native: Vec::new(),
            },
            AgentMessage::ToolResult {
                tool_call_id: "c1".to_string(),
                name: "read_file".to_string(),
                content: "a".repeat(1000), // 历史轮次超长输出，应被微压缩
            },
            AgentMessage::Assistant {
                text: "第二步".to_string(),
                reasoning: String::new(),
                tool_calls: vec![ToolInvocation { id: "c2".to_string(), name: "grep".to_string(), arguments: serde_json::json!({}) }],
                native: Vec::new(),
            },
            AgentMessage::ToolResult {
                tool_call_id: "c2".to_string(),
                name: "grep".to_string(),
                content: "b".repeat(1000), // 倒数第二个 assistant 后的工具结果，属于活跃窗口，不应被完全折叠
            },
            AgentMessage::Assistant {
                text: "第三步完成".to_string(),
                reasoning: String::new(),
                tool_calls: Vec::new(),
                native: Vec::new(),
            },
        ];

        let pruned = prune_agent_messages(&msgs, 8192, 4096, 1024);
        assert_eq!(pruned.len(), 6);

        // 验证更早的历史只读结果被微压缩为紧凑摘要
        match &pruned[2] {
            AgentMessage::ToolResult { content, .. } => {
                assert!(content.contains("[历史工具输出微压缩: 工具 'read_file' 执行完成 (原始约 1000 字符)"));
            }
            _ => panic!("Expected ToolResult"),
        }

        // 验证活跃窗口内的结果依然保留原始内容
        match &pruned[4] {
            AgentMessage::ToolResult { content, .. } => {
                assert_eq!(content, &"b".repeat(1000));
            }
            _ => panic!("Expected ToolResult"),
        }
    }
}
