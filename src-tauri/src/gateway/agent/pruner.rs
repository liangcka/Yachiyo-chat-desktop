use crate::gateway::agent::messages::AgentMessage;

/// 头尾保留量加省略标记须低于阈值，截断结果才不会在下一轮被再次截断、改写缓存前缀
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

/// 微压缩的高水位：模型可见内容（按字符估算）超过它才清理历史工具结果。
/// 按平均约 2.2 字符/token 折算约 7 万 token，在 128K 窗口的模型上也留有余量
pub const MICRO_COMPACT_TRIGGER_CHARS: usize = 160_000;
/// 微压缩的低水位：一旦触发就清理到它以下。只清到高水位以下的话，下一轮又会越线、再次改写前缀
pub const MICRO_COMPACT_TARGET_CHARS: usize = 80_000;
/// 最近的若干个只读结果始终完整保留，模型往往正基于它们做下一步
pub const MICRO_COMPACT_KEEP_RECENT: usize = 5;
/// 短于此长度的结果清理收益不抵信息损失
const MICRO_COMPACT_MIN_CHARS: usize = 300;
const MICRO_COMPACT_MARKER: &str = "[历史工具输出微压缩:";

fn is_error_like(content: &str) -> bool {
    ["Error", "Failed", "错误", "Access denied"].iter().any(|prefix| content.starts_with(prefix))
}

fn message_chars(message: &AgentMessage) -> usize {
    match message {
        AgentMessage::User { text, .. } => text.chars().count(),
        AgentMessage::Assistant { text, reasoning, tool_calls, .. } => {
            text.chars().count()
                + reasoning.chars().count()
                + tool_calls.iter().map(|call| call.name.len() + call.arguments.to_string().chars().count()).sum::<usize>()
        }
        AgentMessage::ToolResult { content, .. } => content.chars().count(),
    }
}

/// 原地整理发给模型的历史，返回本轮折叠的工具结果数。
///
/// 前缀缓存（Anthropic 断点、OpenAI/DeepSeek 自动前缀缓存）要求历史逐字节不变，因此：
/// 1. 超长工具结果只做一次确定性的首尾截断，截断结果低于阈值，之后各轮保持不变；
/// 2. 低于高水位时不改写任何历史；越过高水位后从最早的只读结果开始折叠，直到降到低水位，
///    此后若干轮前缀重新稳定；
/// 3. 最近若干个只读结果、模型尚未看过的本轮结果、错误输出与写入类结果始终保留。
pub fn compact_agent_messages(
    messages: &mut [AgentMessage],
    threshold_chars: usize,
    head_chars: usize,
    tail_chars: usize,
) -> usize {
    for message in messages.iter_mut() {
        if let AgentMessage::ToolResult { content, .. } = message {
            if let Some(pruned) = prune_tool_result_content(content, threshold_chars, head_chars, tail_chars) {
                *content = pruned;
            }
        }
    }

    let mut total: usize = messages.iter().map(message_chars).sum();
    if total <= MICRO_COMPACT_TRIGGER_CHARS {
        return 0;
    }

    // 最后一条 Assistant 之后的工具结果模型还没看过，不能在它看到之前就清掉
    let last_assistant = messages.iter().rposition(|message| matches!(message, AgentMessage::Assistant { .. }));
    let candidates: Vec<usize> = messages
        .iter()
        .enumerate()
        .take(last_assistant.unwrap_or(0))
        .filter_map(|(index, message)| match message {
            AgentMessage::ToolResult { name, content, .. }
                if is_readonly_inspection_tool(name)
                    && !is_error_like(content)
                    && !content.starts_with(MICRO_COMPACT_MARKER)
                    && content.chars().count() > MICRO_COMPACT_MIN_CHARS =>
            {
                Some(index)
            }
            _ => None,
        })
        .collect();
    let clearable = candidates.len().saturating_sub(MICRO_COMPACT_KEEP_RECENT);

    let mut cleared = 0;
    for &index in &candidates[..clearable] {
        if total <= MICRO_COMPACT_TARGET_CHARS {
            break;
        }
        if let AgentMessage::ToolResult { name, content, .. } = &mut messages[index] {
            let original = content.chars().count();
            let folded = format!(
                "{MICRO_COMPACT_MARKER} 工具 '{name}' 执行完成 (原始约 {original} 字符)。历史细节已折叠以优化上下文，若需最新内容请再次调用该工具]"
            );
            total = total - original + folded.chars().count();
            *content = folded;
            cleared += 1;
        }
    }
    cleared
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

    fn read_turn(id: &str, size: usize) -> [AgentMessage; 2] {
        use crate::types::ToolInvocation;
        [
            AgentMessage::Assistant {
                text: String::new(),
                reasoning: String::new(),
                tool_calls: vec![ToolInvocation { id: id.to_string(), name: "read_file".to_string(), arguments: serde_json::json!({}) }],
                native: Vec::new(),
            },
            AgentMessage::ToolResult { tool_call_id: id.to_string(), name: "read_file".to_string(), content: "a".repeat(size) },
        ]
    }

    fn assistant(text: &str) -> AgentMessage {
        AgentMessage::Assistant { text: text.to_string(), reasoning: String::new(), tool_calls: Vec::new(), native: Vec::new() }
    }

    fn conversation(results: usize, size: usize) -> Vec<AgentMessage> {
        let mut messages = vec![AgentMessage::User { text: "开始".to_string(), image_data_url: None }];
        for index in 0..results {
            messages.extend(read_turn(&format!("c{index}"), size));
        }
        messages
    }

    fn is_folded(message: &AgentMessage) -> bool {
        matches!(message, AgentMessage::ToolResult { content, .. } if content.starts_with(MICRO_COMPACT_MARKER))
    }

    fn compact(messages: &mut [AgentMessage]) -> usize {
        compact_agent_messages(messages, DEFAULT_PRUNE_THRESHOLD_CHARS, DEFAULT_PRUNE_HEAD_CHARS, DEFAULT_PRUNE_TAIL_CHARS)
    }

    #[test]
    fn test_oversized_result_is_truncated() {
        let mut messages = vec![
            AgentMessage::User { text: "hello".to_string(), image_data_url: None },
            AgentMessage::ToolResult { tool_call_id: "call_1".to_string(), name: "read_file".to_string(), content: "x".repeat(100) },
        ];
        compact_agent_messages(&mut messages, 50, 10, 5);
        let AgentMessage::ToolResult { content, .. } = &messages[1] else { panic!("Expected ToolResult") };
        assert!(content.contains("[... 工具输出过长"));
        assert!(matches!(&messages[0], AgentMessage::User { text, .. } if text == "hello"));
    }

    #[test]
    fn test_default_truncation_is_idempotent() {
        let mut messages = vec![AgentMessage::ToolResult { tool_call_id: "c".to_string(), name: "grep".to_string(), content: "星".repeat(50_000) }];
        compact(&mut messages);
        let once = format!("{messages:?}");
        compact(&mut messages);
        assert_eq!(format!("{messages:?}"), once);
    }

    #[test]
    fn test_history_is_untouched_below_trigger() {
        // 30 个 5000 字符的读取结果共约 15 万字符，低于高水位：前缀缓存优先，一律不改写
        let mut messages = conversation(30, 5000);
        messages.push(assistant("完成"));
        let before = format!("{messages:?}");
        assert_eq!(compact(&mut messages), 0);
        assert_eq!(format!("{messages:?}"), before);
    }

    #[test]
    fn test_crossing_trigger_clears_oldest_down_to_target_then_stays_stable() {
        let mut messages = conversation(40, 5000);
        messages.push(assistant("继续"));
        assert!(compact(&mut messages) > 0);
        let total: usize = messages.iter().map(message_chars).sum();
        assert!(total <= MICRO_COMPACT_TARGET_CHARS, "应一次清到低水位，实际 {total}");
        assert!(is_folded(&messages[2]), "从最早的结果开始折叠");
        assert!(!is_folded(&messages[messages.len() - 2]));

        // 之后再追加若干轮，只要没再次越过高水位，已发送过的前缀保持逐字节不变
        let prefix_len = messages.len();
        let prefix = format!("{:?}", &messages[..]);
        for index in 0..10 {
            messages.extend(read_turn(&format!("n{index}"), 5000));
        }
        assert_eq!(compact(&mut messages), 0);
        assert_eq!(format!("{:?}", &messages[..prefix_len]), prefix);
    }

    #[test]
    fn test_unseen_results_are_never_cleared() {
        // 单轮并发读取 40 个文件：模型尚未看过这些结果，即使越过高水位也不能清理
        let mut messages = vec![AgentMessage::User { text: "开始".to_string(), image_data_url: None }, assistant("")];
        for index in 0..40 {
            messages.push(AgentMessage::ToolResult { tool_call_id: format!("c{index}"), name: "read_file".to_string(), content: "a".repeat(5000) });
        }
        assert_eq!(compact(&mut messages), 0);
    }

    #[test]
    fn test_keeps_recent_and_error_results() {
        let mut messages = conversation(40, 5000);
        if let AgentMessage::ToolResult { content, .. } = &mut messages[2] {
            *content = format!("错误：{}", "e".repeat(5000));
        }
        messages.push(assistant(""));
        assert!(compact(&mut messages) > 0);
        assert!(!is_folded(&messages[2]), "错误输出始终保留");
        let results: Vec<&AgentMessage> = messages.iter().filter(|m| matches!(m, AgentMessage::ToolResult { .. })).collect();
        assert!(results.iter().rev().take(MICRO_COMPACT_KEEP_RECENT).all(|m| !is_folded(m)), "最近的结果始终保留");
    }
}
