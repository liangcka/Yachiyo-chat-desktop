//! 运行内的上下文预算：按模型窗口估算本次运行的消息体积，超出预算时把较早的轮次折叠为结构化的运行进展摘要。
//!
//! - 折叠以整轮为单位（助手的工具调用连同它的全部工具结果），不会拆开工具调用与结果的配对；
//! - 最近的若干轮原样保留，包括厂商原生输出与思维链，同一运行内仍可原样回传；
//! - 目标（本次请求原文）、用户补充的要求、已执行的操作、改动过的文件与失败记录写进摘要，不会因折叠丢失；
//! - 折叠到不能再折叠仍超出预算时报告溢出，由循环如实停止，而不是让上游报错或静默截断。
use crate::gateway::agent::messages::AgentMessage;
use crate::types::ToolInvocation;
use std::collections::{BTreeSet, HashMap};

/// 未知模型窗口时采用的保守值
pub const DEFAULT_CONTEXT_WINDOW_TOKENS: usize = 64_000;
/// 最近原样保留的轮数
const KEEP_RECENT_TURNS: usize = 2;
/// 摘要中每类条目保留的上限，避免摘要本身无限增长
const MAX_ACTIONS: usize = 60;
const MAX_FAILURES: usize = 20;
const MAX_NOTES: usize = 12;
const MAX_NOTE_CHARS: usize = 240;
/// 仍超出预算时，对保留轮次（最后一轮除外）的工具结果做的强截断
const AGGRESSIVE_HEAD_CHARS: usize = 1_200;
const AGGRESSIVE_TAIL_CHARS: usize = 400;
/// 带图消息按固定开销估算
const IMAGE_TOKENS: usize = 1_500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextBudget {
    /// 消息可用的输入预算（已扣除输出预留与系统提示词、工具定义）
    pub input_tokens: usize,
}

impl ContextBudget {
    /// window_tokens 缺省时取保守默认值；输出预留取窗口的四分之一（上限 16k）
    pub fn for_window(window_tokens: Option<u32>, fixed_overhead_tokens: usize) -> Self {
        let window = window_tokens.map(|value| value as usize).unwrap_or(DEFAULT_CONTEXT_WINDOW_TOKENS);
        let reserve = (window / 4).clamp(1_024, 16_000);
        Self { input_tokens: window.saturating_sub(reserve).saturating_sub(fixed_overhead_tokens).max(2_048) }
    }
}

/// 粗略的 token 估算：按 UTF-8 字节数的三分之一。英文偏高、中文接近一字一 token，宁可早折叠也不让上游溢出
pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(3)
}

fn estimate_call(call: &ToolInvocation) -> usize {
    estimate_tokens(&call.name) + estimate_tokens(&call.arguments.to_string()) + 8
}

pub fn estimate_messages(messages: &[AgentMessage]) -> usize {
    messages
        .iter()
        .map(|message| match message {
            AgentMessage::User { text, image_data_url } => estimate_tokens(text) + if image_data_url.is_some() { IMAGE_TOKENS } else { 0 } + 4,
            AgentMessage::Assistant { text, reasoning, tool_calls, native } => {
                estimate_tokens(text)
                    + estimate_tokens(reasoning)
                    + tool_calls.iter().map(estimate_call).sum::<usize>()
                    + native.iter().map(|value| estimate_tokens(&value.to_string())).sum::<usize>()
                    + 4
            }
            AgentMessage::ToolResult { content, .. } => estimate_tokens(content) + 8,
        })
        .sum()
}

fn truncate_chars(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(limit).collect();
    format!("{head}…")
}

fn first_line(text: &str, limit: usize) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("");
    truncate_chars(line, limit)
}

fn call_target(call: &ToolInvocation) -> Option<String> {
    let arguments = call.arguments.as_object()?;
    ["path", "command", "pattern", "url", "query"]
        .iter()
        .find_map(|key| arguments.get(*key).and_then(|value| value.as_str()))
        .map(|value| truncate_chars(value, 120))
}

/// 本次运行的进展：工具结果在执行时登记，较早的轮次被折叠时据此写出摘要
#[derive(Debug, Default)]
pub struct RunProgress {
    outcomes: HashMap<String, (bool, String)>,
    constraints: Vec<String>,
    actions: Vec<String>,
    files: BTreeSet<String>,
    failures: Vec<String>,
    notes: Vec<String>,
    folded_turns: usize,
}

impl RunProgress {
    /// 登记工具结果（是否失败与输出首行），供折叠时引用
    pub fn record_result(&mut self, call_id: &str, is_error: bool, output: &str) {
        self.outcomes.insert(call_id.to_string(), (is_error, first_line(output, 200)));
    }

    /// 运行中送达的补充要求属于约束，折叠后仍须保留
    pub fn record_constraint(&mut self, text: &str) {
        self.constraints.push(text.trim().to_string());
    }

    pub fn folded_turns(&self) -> usize {
        self.folded_turns
    }

    fn fold_turn(&mut self, turn: &[AgentMessage]) {
        for message in turn {
            let AgentMessage::Assistant { text, tool_calls, .. } = message else { continue };
            if !text.trim().is_empty() && self.notes.len() < MAX_NOTES {
                self.notes.push(truncate_chars(text, MAX_NOTE_CHARS));
            }
            for call in tool_calls {
                let target = call_target(call);
                let (failed, detail) = self.outcomes.get(&call.id).cloned().unwrap_or((false, String::new()));
                let label = match &target {
                    Some(target) => format!("{} {}", call.name, target),
                    None => call.name.clone(),
                };
                if self.actions.len() < MAX_ACTIONS {
                    self.actions.push(format!("{label}：{}", if failed { "失败" } else { "完成" }));
                }
                if failed && self.failures.len() < MAX_FAILURES {
                    self.failures.push(if detail.is_empty() { label.clone() } else { format!("{label}：{detail}") });
                }
                if !failed && matches!(call.name.as_str(), "write_file" | "edit_file") {
                    if let Some(path) = call.arguments.get("path").and_then(|value| value.as_str()) {
                        self.files.insert(path.replace('\\', "/"));
                    }
                }
            }
        }
        self.folded_turns += 1;
    }

    /// 摘要正文：附在本次请求原文之后，作为运行的既定事实交给模型
    pub fn render(&self) -> String {
        let mut sections = vec![format!(
            "[运行进展摘要：为控制上下文，本次运行较早的 {} 轮步骤已折叠。以下内容来自实际执行记录，请据此继续；需要细节时重新读取文件或运行命令]",
            self.folded_turns
        )];
        if !self.constraints.is_empty() {
            sections.push(format!("用户在任务进行中补充的要求：\n{}", self.constraints.iter().map(|item| format!("- {item}")).collect::<Vec<_>>().join("\n")));
        }
        if !self.files.is_empty() {
            sections.push(format!("已修改的文件：\n{}", self.files.iter().map(|path| format!("- {path}")).collect::<Vec<_>>().join("\n")));
        }
        if !self.failures.is_empty() {
            sections.push(format!("出现过的失败：\n{}", self.failures.iter().map(|item| format!("- {item}")).collect::<Vec<_>>().join("\n")));
        }
        if !self.actions.is_empty() {
            sections.push(format!("已执行的操作（按顺序）：\n{}", self.actions.iter().map(|item| format!("- {item}")).collect::<Vec<_>>().join("\n")));
        }
        if !self.notes.is_empty() {
            sections.push(format!("此前的说明：\n{}", self.notes.iter().map(|item| format!("- {item}")).collect::<Vec<_>>().join("\n")));
        }
        sections.join("\n\n")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Compaction {
    pub folded_turns: usize,
    pub before_tokens: usize,
    pub after_tokens: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextOverflow {
    pub tokens: usize,
    pub budget: usize,
}

/// 本次运行中各轮（助手消息连同其后的工具结果与附图）的范围
fn turn_ranges(messages: &[AgentMessage], run_start: usize) -> Vec<(usize, usize)> {
    let starts: Vec<usize> = messages
        .iter()
        .enumerate()
        .skip(run_start + 1)
        .filter(|(_, message)| matches!(message, AgentMessage::Assistant { .. }))
        .map(|(index, _)| index)
        .collect();
    starts
        .iter()
        .enumerate()
        .map(|(position, start)| (*start, starts.get(position + 1).copied().unwrap_or(messages.len())))
        .collect()
}

fn truncate_middle(content: &str) -> Option<String> {
    crate::gateway::agent::pruner::prune_tool_result_content(content, AGGRESSIVE_HEAD_CHARS + AGGRESSIVE_TAIL_CHARS, AGGRESSIVE_HEAD_CHARS, AGGRESSIVE_TAIL_CHARS)
}

/// 发给模型的消息超出预算时折叠较早的轮次。measure 计算发给模型的实际体积（含裁剪）。
/// goal 为本次请求原文；折叠后 messages[run_start] 改写为“原文 + 运行进展摘要”。
pub fn compact_to_budget(
    messages: &mut Vec<AgentMessage>,
    run_start: usize,
    goal: &str,
    progress: &mut RunProgress,
    budget: ContextBudget,
    measure: impl Fn(&[AgentMessage]) -> usize,
) -> Result<Option<Compaction>, ContextOverflow> {
    let before = measure(messages);
    if before <= budget.input_tokens {
        return Ok(None);
    }
    let folded_before = progress.folded_turns;
    loop {
        let turns = turn_ranges(messages, run_start);
        if turns.len() <= KEEP_RECENT_TURNS {
            break;
        }
        let (start, end) = turns[0];
        let removed: Vec<AgentMessage> = messages.drain(start..end).collect();
        progress.fold_turn(&removed);
        if let Some(AgentMessage::User { text, .. }) = messages.get_mut(run_start) {
            *text = format!("{goal}\n\n{}", progress.render());
        }
        if measure(messages) <= budget.input_tokens {
            break;
        }
    }
    let mut after = measure(messages);
    if after > budget.input_tokens {
        // 已无可折叠的轮次：保留轮次中除最后一轮外的长工具结果只留首尾
        let turns = turn_ranges(messages, run_start);
        let last_turn_start = turns.last().map(|(start, _)| *start).unwrap_or(messages.len());
        for message in messages.iter_mut().take(last_turn_start).skip(run_start + 1) {
            if let AgentMessage::ToolResult { content, .. } = message {
                if let Some(truncated) = truncate_middle(content) {
                    *content = truncated;
                }
            }
        }
        after = measure(messages);
    }
    if after > budget.input_tokens {
        return Err(ContextOverflow { tokens: after, budget: budget.input_tokens });
    }
    Ok(Some(Compaction { folded_turns: progress.folded_turns - folded_before, before_tokens: before, after_tokens: after }))
}
