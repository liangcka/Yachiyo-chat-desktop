//! 运行事件日志：运行产生的每个事件按序编号后存入日志，SSE 连接只是日志的订阅者。
//! 连接断开不影响运行；重新连接时从客户端最后收到的序号之后回填，序号保证不重复、不乱序。
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 日志保留的事件上限；超出时丢弃最早的事件，回填时以 gap 事件告知缺口
const MAX_EVENTS: usize = 20_000;
const MAX_BYTES: usize = 16 * 1024 * 1024;
/// 订阅者空闲时的心跳周期，需明显小于客户端的流空闲超时（45 秒）
const HEARTBEAT_PERIOD: Duration = Duration::from_secs(5);

#[derive(Default)]
struct Inner {
    next_seq: u64,
    events: VecDeque<(u64, String)>,
    bytes: usize,
    finished: bool,
}

#[derive(Default)]
pub struct RunEventLog {
    inner: Mutex<Inner>,
    notify: tokio::sync::Notify,
}

impl std::fmt::Debug for RunEventLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunEventLog").field("last_seq", &self.last_seq()).finish()
    }
}

/// 一次读取的结果：after 之后仍保留的事件；gap 为已被丢弃、无法回填的序号区间
#[derive(Debug, Default)]
pub struct LogRead {
    pub events: Vec<(u64, String)>,
    pub gap: Option<(u64, u64)>,
    pub finished: bool,
}

impl RunEventLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加一个已编码的 SSE 事件（不含 id 行），返回它的序号（从 1 开始）
    pub fn push(&self, frame: String) -> u64 {
        let seq = {
            let Ok(mut inner) = self.inner.lock() else { return 0 };
            if inner.finished {
                return 0;
            }
            inner.next_seq += 1;
            let seq = inner.next_seq;
            inner.bytes += frame.len();
            inner.events.push_back((seq, frame));
            while inner.events.len() > MAX_EVENTS || (inner.bytes > MAX_BYTES && inner.events.len() > 1) {
                if let Some((_, dropped)) = inner.events.pop_front() {
                    inner.bytes -= dropped.len();
                }
            }
            seq
        };
        self.notify.notify_waiters();
        seq
    }

    /// 运行结束：不再追加事件，订阅者读完剩余事件后结束
    pub fn finish(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.finished = true;
        }
        self.notify.notify_waiters();
    }

    pub fn last_seq(&self) -> u64 {
        self.inner.lock().map(|inner| inner.next_seq).unwrap_or(0)
    }

    pub fn is_finished(&self) -> bool {
        self.inner.lock().map(|inner| inner.finished).unwrap_or(true)
    }

    pub fn read_after(&self, after: u64) -> LogRead {
        let Ok(inner) = self.inner.lock() else { return LogRead { finished: true, ..LogRead::default() } };
        let first = inner.events.front().map(|(seq, _)| *seq).unwrap_or(inner.next_seq + 1);
        let gap = (after + 1 < first && after < inner.next_seq).then(|| (after + 1, first - 1));
        LogRead {
            events: inner.events.iter().filter(|(seq, _)| *seq > after).cloned().collect(),
            gap,
            finished: inner.finished,
        }
    }
}

fn with_id(seq: u64, frame: &str) -> String {
    format!("id: {seq}\n{frame}")
}

/// 订阅日志：先回填 after 之后的事件，再实时推送新事件，运行结束且读完后关闭。
/// 订阅者断开只是停止读取，不影响运行。
pub fn subscribe(log: Arc<RunEventLog>, after: u64) -> impl futures::Stream<Item = Result<String, axum::Error>> {
    subscribe_with_heartbeat(log, after, HEARTBEAT_PERIOD)
}

pub fn subscribe_with_heartbeat(
    log: Arc<RunEventLog>,
    after: u64,
    heartbeat: Duration,
) -> impl futures::Stream<Item = Result<String, axum::Error>> {
    async_stream::stream! {
        let mut cursor = after;
        let mut first = true;
        loop {
            // 先登记等待再读取，读取与等待之间追加的事件不会被错过
            let notified = log.notify.notified();
            let read = log.read_after(cursor);
            if first {
                first = false;
                if let Some((from, to)) = read.gap {
                    yield Ok(format!("event: gap\ndata: {}\n\n", serde_json::json!({ "from": from, "to": to })));
                }
            }
            for (seq, frame) in &read.events {
                cursor = *seq;
                yield Ok(with_id(*seq, frame));
            }
            if read.finished {
                break;
            }
            if read.events.is_empty() {
                tokio::select! {
                    _ = notified => {}
                    _ = tokio::time::sleep(heartbeat) => yield Ok(crate::gateway::stream::encode_ping().to_string()),
                }
            }
        }
    }
}
