use crate::gateway::agent::run_events::RunEventLog;
use crate::gateway::agent::run_records::{now_ms, recorded_status, RecordedStatus, RunEndStatus, RunRecord, RunRecordStore};
use crate::tools::process::{ProcessInfo, ProcessTable};
use crate::types::{AgentExecutionMode, ProviderId};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 一次 Agent 运行的固定身份：工作区在请求进入网关时确定，运行期间不再随界面的项目选择变化
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// 规范化后的工作区；None 表示该运行未绑定项目
    #[serde(serialize_with = "serialize_workspace")]
    pub workspace: Option<PathBuf>,
    pub provider: ProviderId,
    pub model: String,
    pub execution_mode: AgentExecutionMode,
    pub started_at: u64,
}

fn serialize_workspace<S: serde::Serializer>(workspace: &Option<PathBuf>, serializer: S) -> Result<S::Ok, S::Error> {
    match workspace {
        Some(path) => serializer.serialize_some(&crate::tools::display_path(path)),
        None => serializer.serialize_none(),
    }
}

/// 用户在运行过程中追加的要求
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Supplement {
    pub id: String,
    pub text: String,
}

/// 补充要求单条长度上限（字符），与输入框上限一致
pub const MAX_SUPPLEMENT_CHARS: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupplementRejected {
    /// 运行不存在或已结束
    NotActive,
    /// 运行已请求取消
    Cancelling,
    /// 运行已进入收尾，不再读取补充要求
    Closed,
    Invalid,
}

impl SupplementRejected {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotActive => "RUN_NOT_ACTIVE",
            Self::Cancelling => "RUN_CANCELLING",
            Self::Closed => "RUN_FINISHING",
            Self::Invalid => "INVALID_SUPPLEMENT",
        }
    }
}

/// 运行中的补充要求队列：执行循环在每次调用模型之前取出并送达。
/// 循环准备结束时用 `close_if_empty` 原子地关闭：关闭前到达的补充会让循环继续一轮，关闭后到达的被拒绝，
/// 不会出现“已接受却永远不送达”的补充。
#[derive(Debug, Default)]
pub struct SupplementQueue {
    inner: Mutex<(VecDeque<Supplement>, bool)>,
}

impl SupplementQueue {
    pub fn push(&self, supplement: Supplement) -> Result<(), SupplementRejected> {
        let mut inner = self.inner.lock().map_err(|_| SupplementRejected::Closed)?;
        if inner.1 {
            return Err(SupplementRejected::Closed);
        }
        if inner.0.iter().any(|queued| queued.id == supplement.id) {
            return Ok(());
        }
        inner.0.push_back(supplement);
        Ok(())
    }

    pub fn drain(&self) -> Vec<Supplement> {
        self.inner.lock().map(|mut inner| inner.0.drain(..).collect()).unwrap_or_default()
    }

    /// 没有待送达的补充时关闭队列并返回 true；仍有补充时保持打开并返回 false
    pub fn close_if_empty(&self) -> bool {
        match self.inner.lock() {
            Ok(mut inner) if inner.0.is_empty() => {
                inner.1 = true;
                true
            }
            Ok(_) => false,
            Err(_) => true,
        }
    }

    /// 运行结束：关闭队列，返回未能送达的补充
    pub fn close(&self) -> Vec<Supplement> {
        self.inner
            .lock()
            .map(|mut inner| {
                inner.1 = true;
                inner.0.drain(..).collect()
            })
            .unwrap_or_default()
    }
}

/// 活跃运行的控制面：取消标志由执行循环轮询，进程表登记运行中启动的受管命令
pub struct RunControl {
    pub info: RunInfo,
    pub cancelled: Arc<AtomicBool>,
    pub processes: Arc<ProcessTable>,
    pub supplements: Arc<SupplementQueue>,
    /// 运行事件日志：SSE 连接只是订阅者，断开后可按序号回填
    pub events: Arc<RunEventLog>,
    end: Mutex<Option<(RunEndStatus, Option<String>)>>,
}

/// 运行在网关中的状态：仍在执行，或已结束（结束后的事件日志短时间保留供重连回填）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunState {
    Active {
        run: RunSnapshot,
        #[serde(rename = "lastSeq")]
        last_seq: u64,
    },
    Finished {
        status: RecordedStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(rename = "lastSeq")]
        last_seq: u64,
        /// 事件日志仍在内存中，可以回填剩余事件
        retained: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    /// 已请求取消，正在等待命令等操作收尾
    Cancelling,
    /// 等待同一项目中其他运行完成写入
    WaitingForWorkspace,
}

/// 对外的运行快照：身份、状态与正在执行的命令
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSnapshot {
    #[serde(flatten)]
    pub info: RunInfo,
    pub status: RunStatus,
    pub processes: Vec<ProcessInfo>,
}

impl RunControl {
    pub fn snapshot(&self) -> RunSnapshot {
        RunSnapshot {
            info: self.info.clone(),
            status: if self.cancelled.load(Ordering::SeqCst) { RunStatus::Cancelling } else { RunStatus::Running },
            processes: self.processes.list(),
        }
    }
}

/// 已结束运行的事件日志保留数量与时长，供断线的客户端回填最后的事件
const FINISHED_RETAIN_COUNT: usize = 16;
const FINISHED_RETAIN_FOR: Duration = Duration::from_secs(30 * 60);

/// 网关内活跃运行的登记表：同一 runId 同时只能有一个运行，避免重复提交或重连误触发第二次执行
#[derive(Default)]
pub struct RunRegistry {
    active: Mutex<HashMap<String, Arc<RunControl>>>,
    finished: Mutex<VecDeque<(Instant, Arc<RunControl>)>>,
    records: Option<RunRecordStore>,
}

/// 运行登记的持有凭据，随执行任务结束（而不是随 SSE 连接断开）注销
pub struct RunHandle {
    registry: Arc<RunRegistry>,
    control: Arc<RunControl>,
}

impl RunHandle {
    pub fn control(&self) -> &Arc<RunControl> {
        &self.control
    }

    /// 记录运行的结局；运行登记注销时写入运行记录
    pub fn complete(&self, status: RunEndStatus, reason: Option<String>) {
        if let Ok(mut end) = self.control.end.lock() {
            *end = Some((status, reason));
        }
    }
}

impl Drop for RunHandle {
    fn drop(&mut self) {
        if let Ok(mut active) = self.registry.active.lock() {
            active.remove(&self.control.info.run_id);
        }
        self.control.events.finish();
        let (status, reason) = self
            .control
            .end
            .lock()
            .ok()
            .and_then(|end| end.clone())
            .unwrap_or((RunEndStatus::Failed, Some("ended_without_status".to_string())));
        self.registry.write_record(&self.control, status, reason);
        if let Ok(mut finished) = self.registry.finished.lock() {
            finished.push_back((Instant::now(), Arc::clone(&self.control)));
            while finished.len() > FINISHED_RETAIN_COUNT {
                finished.pop_front();
            }
        }
    }
}

pub const RUN_ALREADY_ACTIVE: &str = "RUN_ALREADY_ACTIVE";

/// runId 进入审批编号与检查点清单，只接受与检查点编号相同的安全字符集
pub fn is_valid_run_id(run_id: &str) -> bool {
    !run_id.is_empty() && run_id.len() <= 64 && run_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub fn generate_run_id() -> String {
    format!(
        "{}-{:08x}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        rand::random::<u32>()
    )
}

/// 审批编号由运行编号与工具调用编号组成，审批只对所属运行有效
pub fn approval_request_id(run_id: &str, call_id: &str) -> String {
    format!("{run_id}-{call_id}")
}

impl RunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 带运行记录的登记表：运行开始与结束时写入记录，重启后可区分结局
    pub fn with_records(dir: impl Into<std::path::PathBuf>) -> Self {
        Self { records: Some(RunRecordStore::new(dir)), ..Self::default() }
    }

    fn write_record(&self, control: &RunControl, status: RunEndStatus, reason: Option<String>) {
        let Some(records) = self.records.as_ref() else { return };
        let record = RunRecord {
            run_id: control.info.run_id.clone(),
            conversation_id: control.info.conversation_id.clone(),
            workspace: control.info.workspace.as_deref().map(crate::tools::display_path),
            started_at: control.info.started_at,
            status,
            ended_at: (status != RunEndStatus::Running).then(now_ms),
            reason,
            last_seq: control.events.last_seq(),
        };
        if let Err(error) = records.write(&record) {
            tracing::warn!("运行记录写入失败: {}", error);
        }
    }

    /// 活跃的运行，或刚结束、事件日志仍保留的运行
    pub fn lookup(&self, run_id: &str) -> Option<Arc<RunControl>> {
        if let Some(control) = self.control(run_id) {
            return Some(control);
        }
        let mut finished = self.finished.lock().ok()?;
        finished.retain(|(at, _)| at.elapsed() < FINISHED_RETAIN_FOR);
        finished.iter().rev().find(|(_, control)| control.info.run_id == run_id).map(|(_, control)| Arc::clone(control))
    }

    /// 运行的状态：活跃、已结束（事件可能仍可回填）或从运行记录得知的结局；从未见过时返回 None
    pub fn state(&self, run_id: &str) -> Option<RunState> {
        if let Some(control) = self.control(run_id) {
            return Some(RunState::Active { run: control.snapshot(), last_seq: control.events.last_seq() });
        }
        if let Some(control) = self.lookup(run_id) {
            let (status, reason) = control.end.lock().ok().and_then(|end| end.clone()).unwrap_or((RunEndStatus::Failed, None));
            let status = match status {
                RunEndStatus::Completed => RecordedStatus::Completed,
                RunEndStatus::Cancelled => RecordedStatus::Cancelled,
                RunEndStatus::Failed | RunEndStatus::Running => RecordedStatus::Failed,
            };
            return Some(RunState::Finished { status, reason, last_seq: control.events.last_seq(), retained: true });
        }
        let record = self.records.as_ref()?.read(run_id)?;
        Some(RunState::Finished { status: recorded_status(&record), reason: record.reason.clone(), last_seq: record.last_seq, retained: false })
    }

    pub fn begin(self: &Arc<Self>, info: RunInfo) -> Result<RunHandle, String> {
        if !is_valid_run_id(&info.run_id) {
            return Err("INVALID_RUN_ID".to_string());
        }
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        if active.contains_key(&info.run_id) {
            return Err(RUN_ALREADY_ACTIVE.to_string());
        }
        let control = Arc::new(RunControl {
            info,
            cancelled: Arc::new(AtomicBool::new(false)),
            processes: Arc::new(ProcessTable::new()),
            supplements: Arc::new(SupplementQueue::default()),
            events: Arc::new(RunEventLog::new()),
            end: Mutex::new(None),
        });
        active.insert(control.info.run_id.clone(), Arc::clone(&control));
        drop(active);
        self.write_record(&control, RunEndStatus::Running, None);
        Ok(RunHandle { registry: Arc::clone(self), control })
    }

    pub fn get(&self, run_id: &str) -> Option<RunInfo> {
        self.control(run_id).map(|control| control.info.clone())
    }

    pub fn control(&self, run_id: &str) -> Option<Arc<RunControl>> {
        self.active.lock().ok()?.get(run_id).cloned()
    }

    pub fn list(&self) -> Vec<RunSnapshot> {
        let controls: Vec<Arc<RunControl>> = self.active.lock().map(|active| active.values().cloned().collect()).unwrap_or_default();
        let mut runs: Vec<RunSnapshot> = controls.iter().map(|control| control.snapshot()).collect();
        runs.sort_by_key(|run| run.info.started_at);
        runs
    }

    /// 请求取消运行：执行循环停止调度新工具，终止运行中的命令并等待收尾后才结束运行。
    /// 返回取消时仍在执行的命令；运行不存在（已结束）时返回 None
    pub fn cancel(&self, run_id: &str) -> Option<RunSnapshot> {
        let control = self.control(run_id)?;
        control.cancelled.store(true, Ordering::SeqCst);
        Some(control.snapshot())
    }

    /// 只停止运行中的某条命令，运行本身继续，模型会收到命令被停止的结果
    pub fn stop_process(&self, run_id: &str, execution_id: &str) -> bool {
        self.control(run_id).is_some_and(|control| control.processes.stop(execution_id))
    }

    pub fn stop_call(&self, run_id: &str, call_id: &str) -> bool {
        self.control(run_id).is_some_and(|control| control.processes.stop_call(call_id))
    }

    /// 追加补充要求：运行已结束、已取消或正在收尾时拒绝，界面据此提示改为发送新消息
    pub fn supplement(&self, run_id: &str, supplement: Supplement) -> Result<(), SupplementRejected> {
        if !is_valid_run_id(&supplement.id) || supplement.text.trim().is_empty() || supplement.text.chars().count() > MAX_SUPPLEMENT_CHARS {
            return Err(SupplementRejected::Invalid);
        }
        let control = self.control(run_id).ok_or(SupplementRejected::NotActive)?;
        if control.cancelled.load(Ordering::SeqCst) {
            return Err(SupplementRejected::Cancelling);
        }
        control.supplements.push(supplement)
    }

    /// 审批只在所属运行仍在执行且未被取消时有效：取消之后迟到的批准不得触发执行
    pub fn accepts_approval(&self, run_id: &str, request_id: &str) -> bool {
        let Some(control) = self.control(run_id) else { return false };
        !control.cancelled.load(Ordering::SeqCst) && request_id.starts_with(&format!("{run_id}-"))
    }
}
