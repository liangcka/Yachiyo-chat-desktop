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

/// 扫描 Agent 消息列表，将其中的超长 ToolResult 执行无模型修剪，返回用于组装 Prompt 的紧凑消息副本
pub fn prune_agent_messages(
    messages: &[AgentMessage],
    threshold_chars: usize,
    head_chars: usize,
    tail_chars: usize,
) -> Vec<AgentMessage> {
    messages
        .iter()
        .map(|msg| match msg {
            AgentMessage::ToolResult {
                tool_call_id,
                name,
                content,
            } => {
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
}
