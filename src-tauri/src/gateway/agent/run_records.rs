//! 最小运行记录：每个运行开始与结束时各写一次，应用重启后据此区分已完成、失败、已取消与被中断的运行。
//! 记录只描述运行的结局，不保存对话内容；仍标记为运行中的记录说明进程在运行结束前退出了。
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 记录目录保留的文件上限，超出时删除最早修改的记录
const MAX_RECORDS: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunEndStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub started_at: u64,
    pub status: RunEndStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    /// 结束原因：done 的 reason（cancelled / loop_detected）、截断或错误码
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// 运行写出的最后一个事件序号
    #[serde(default)]
    pub last_seq: u64,
}

/// 对外的运行状态：interrupted 表示记录仍为运行中，但当前进程里没有这个运行
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordedStatus {
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone)]
pub struct RunRecordStore {
    dir: PathBuf,
}

impl RunRecordStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path(&self, run_id: &str) -> Option<PathBuf> {
        crate::gateway::agent::run_registry::is_valid_run_id(run_id).then(|| self.dir.join(format!("{run_id}.json")))
    }

    pub fn write(&self, record: &RunRecord) -> Result<(), String> {
        let path = self.path(&record.run_id).ok_or("运行编号无效")?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(record).map_err(|e| e.to_string())?;
        // 先写临时文件再改名，进程中途退出不会留下半截记录
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        fs::rename(&temp, &path).map_err(|e| e.to_string())?;
        self.prune();
        Ok(())
    }

    pub fn read(&self, run_id: &str) -> Option<RunRecord> {
        let bytes = fs::read(self.path(run_id)?).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn prune(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else { return };
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
            .collect();
        if files.len() <= MAX_RECORDS {
            return;
        }
        files.sort_by_key(|(modified, _)| *modified);
        for (_, path) in files.iter().take(files.len() - MAX_RECORDS) {
            let _ = fs::remove_file(path);
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// 记录在当前进程里已不活跃时的结局
pub fn recorded_status(record: &RunRecord) -> RecordedStatus {
    match record.status {
        RunEndStatus::Running => RecordedStatus::Interrupted,
        RunEndStatus::Completed => RecordedStatus::Completed,
        RunEndStatus::Failed => RecordedStatus::Failed,
        RunEndStatus::Cancelled => RecordedStatus::Cancelled,
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}
