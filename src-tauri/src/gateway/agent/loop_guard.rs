//! Agent 循环检测：轮次不设上限，改由“没有进展的重复”决定何时停下。
//!
//! - 工具循环：按轮记录工具调用签名，末尾出现周期为 1～3 轮的完整重复即判定为循环。
//!   调用与结果都相同说明模型看到的信息没有变化，重复 3 个周期即触发；结果在变（例如轮询）
//!   时只看调用本身，放宽到 5 个周期。
//! - 复读：流式思考或正文在近期窗口内反复出现同一段文本，属于解码退化，立即中断该轮。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::types::ToolInvocation;

/// done 事件的结束原因：检测到循环后提前结束（与前端 chat-client 的契约）
pub const DONE_REASON_LOOP_DETECTED: &str = "loop_detected";

/// 执行器在流式输出中检测到复读时返回的错误标记，循环据此结束运行而非按上游故障处理
pub const REPETITION_LOOP_DETECTED: &str = "agent-repetition-loop-detected";

/// 首次检测到工具循环时追加到该轮最后一条工具结果之后的提醒
pub const TOOL_LOOP_NUDGE: &str = "\n\n[循环提醒] 你已连续多次执行相同的工具调用，结果没有新的变化。不要再重复这个操作：换一种方法推进，或者直接向用户说明目前的进展与卡住的原因。";

const MAX_PERIOD: usize = 3;
const REPEATS_WITH_SAME_RESULT: usize = 3;
const REPEATS_CALL_ONLY: usize = 5;

/// 判定结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolLoopVerdict {
    Progressing,
    /// 首次检测到循环：提醒模型换方法，检测窗口清空重新计数
    Nudge,
    /// 提醒之后仍在循环：停止运行
    Stop,
}

#[derive(Debug, Default)]
pub struct ToolLoopDetector {
    with_results: Vec<u64>,
    calls_only: Vec<u64>,
    nudged: bool,
}

fn fingerprint(calls: &[ToolInvocation], outputs: Option<&[String]>) -> u64 {
    let mut hasher = DefaultHasher::new();
    for (index, call) in calls.iter().enumerate() {
        call.name.hash(&mut hasher);
        call.arguments.to_string().hash(&mut hasher);
        if let Some(outputs) = outputs {
            outputs.get(index).hash(&mut hasher);
        }
    }
    hasher.finish()
}

/// 序列末尾是否由同一个长度为 1～MAX_PERIOD 的片段连续重复 repeats 次构成
fn ends_with_cycle(history: &[u64], repeats: usize) -> bool {
    (1..=MAX_PERIOD).any(|period| {
        let span = period * repeats;
        history.len() >= span && {
            let tail = &history[history.len() - span..];
            (period..span).all(|i| tail[i] == tail[i - period])
        }
    })
}

impl ToolLoopDetector {
    /// 记录一轮的工具调用及其回填给模型的结果
    pub fn record(&mut self, calls: &[ToolInvocation], outputs: &[String]) -> ToolLoopVerdict {
        self.with_results.push(fingerprint(calls, Some(outputs)));
        self.calls_only.push(fingerprint(calls, None));
        let looping = ends_with_cycle(&self.with_results, REPEATS_WITH_SAME_RESULT)
            || ends_with_cycle(&self.calls_only, REPEATS_CALL_ONLY);
        if !looping {
            return ToolLoopVerdict::Progressing;
        }
        if self.nudged {
            return ToolLoopVerdict::Stop;
        }
        self.nudged = true;
        self.with_results.clear();
        self.calls_only.clear();
        ToolLoopVerdict::Nudge
    }
}

/// 复读检测窗口：只保留最近这么多字节
const WINDOW_BYTES: usize = 16 * 1024;
/// 每新增这么多字节检查一次
const CHECK_EVERY_BYTES: usize = 256;
/// 取窗口末尾这么多字节作为样本片段
const SAMPLE_BYTES: usize = 80;
/// 样本片段至少包含的不同字符数，排除分隔线、空白等天然重复的排版
const MIN_DISTINCT_CHARS: usize = 10;
/// 样本片段在窗口内不重叠出现的次数达到该值即判定为复读
const REPEAT_THRESHOLD: usize = 8;

#[derive(Debug, Default)]
pub struct RepetitionDetector {
    window: String,
    unchecked: usize,
}

impl RepetitionDetector {
    /// 追加一段流式文本，返回是否已陷入复读
    pub fn push(&mut self, text: &str) -> bool {
        self.window.push_str(text);
        self.unchecked += text.len();
        if self.window.len() > WINDOW_BYTES {
            let mut cut = self.window.len() - WINDOW_BYTES;
            while !self.window.is_char_boundary(cut) {
                cut += 1;
            }
            self.window.drain(..cut);
        }
        if self.unchecked < CHECK_EVERY_BYTES {
            return false;
        }
        self.unchecked = 0;
        self.is_repeating()
    }

    fn is_repeating(&self) -> bool {
        if self.window.len() < SAMPLE_BYTES * REPEAT_THRESHOLD {
            return false;
        }
        let mut start = self.window.len() - SAMPLE_BYTES;
        while !self.window.is_char_boundary(start) {
            start -= 1;
        }
        let sample = &self.window[start..];
        let mut distinct: Vec<char> = sample.chars().collect();
        distinct.sort_unstable();
        distinct.dedup();
        distinct.len() >= MIN_DISTINCT_CHARS && self.window.matches(sample).count() >= REPEAT_THRESHOLD
    }
}
