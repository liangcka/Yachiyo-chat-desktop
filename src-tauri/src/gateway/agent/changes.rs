//! 运行改动账本：记录一次运行实际改动了哪些文件、改动前后的版本，供任务级审阅与安全撤销使用。
//!
//! 基线取自运行自己第一次改动该文件之前的内容（文件工具写前读取，命令与 MCP 取本轮检查点），
//! 不用 Git HEAD 代替，任务开始前已有的未提交改动因此不会被当作本次改动。
//! 文件当前版本与运行写入的版本不一致时，说明之后被用户或其他任务改过，审阅以冲突呈现。
use crate::gateway::agent::checkpoint::{
    canonical_workspace, digest, excluded, is_link, relative_string, storage_root, CheckpointStore, RUN_LEDGER_DIR,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const LEDGER_VERSION: u32 = 1;
/// 文件指纹扫描的条目上限，与检查点一致
const MAX_ENTRIES: usize = crate::gateway::agent::checkpoint::MAX_FILES;
/// 单个基线/版本文件的保存上限
const MAX_BLOB_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSource {
    /// write_file / edit_file：改动路径与内容确定
    FileTool,
    /// 命令或 MCP 执行窗口内观察到的改动
    Command,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

impl FileVersion {
    pub fn absent() -> Self {
        Self { present: false, digest: None }
    }

    fn of(bytes: Option<&[u8]>) -> Self {
        match bytes {
            Some(bytes) => Self { present: true, digest: Some(digest(bytes)) },
            None => Self::absent(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub path: String,
    /// 本次运行第一次改动之前的版本
    pub baseline: FileVersion,
    /// 本次运行最后一次改动之后的版本
    pub agent: FileVersion,
    pub source: ChangeSource,
    pub calls: Vec<String>,
    /// 用户在审阅中处理（保留或部分撤销）之后的版本
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewed: Option<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LedgerFile {
    version: u32,
    run_id: String,
    workspace: String,
    entries: BTreeMap<String, LedgerEntry>,
    updated_at: u64,
}

/// 文件的轻量指纹（大小与修改时间），用于找出命令执行窗口内变化的文件
pub type Fingerprint = HashMap<String, (u64, Option<SystemTime>)>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn valid_run_id(run_id: &str) -> bool {
    crate::gateway::agent::run_registry::is_valid_run_id(run_id)
}

/// 扫描工作区的文件指纹；跳过依赖、构建与 Git 元数据目录，不跟随链接
pub fn fingerprint(root: &Path) -> Result<Fingerprint, String> {
    let root = canonical_workspace(root)?;
    let mut prints = HashMap::new();
    let mut stack = vec![root.clone()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(&directory) else { continue };
        for entry in entries.flatten() {
            if excluded(&entry.file_name()) {
                continue;
            }
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else { continue };
            if is_link(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() {
                prints.insert(relative_string(&path, &root)?, (metadata.len(), metadata.modified().ok()));
                if prints.len() > MAX_ENTRIES {
                    return Err("工作区文件过多，无法跟踪本次改动".to_string());
                }
            }
        }
    }
    Ok(prints)
}

/// 两次指纹之间新增、删除或内容可能变化的文件
pub fn changed_paths(before: &Fingerprint, after: &Fingerprint) -> Vec<String> {
    let mut changed: Vec<String> = after
        .iter()
        .filter(|(path, print)| before.get(*path) != Some(*print))
        .map(|(path, _)| path.clone())
        .chain(before.keys().filter(|path| !after.contains_key(*path)).cloned())
        .collect();
    changed.sort();
    changed.dedup();
    changed
}

/// 运行改动账本；存放在检查点私有存储中，普通文件工具无法读写
pub struct ChangeLedger {
    workspace: PathBuf,
    storage_base: PathBuf,
    directory: PathBuf,
    file: LedgerFile,
}

impl std::fmt::Debug for ChangeLedger {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChangeLedger").field("run_id", &self.file.run_id).field("entries", &self.file.entries.len()).finish()
    }
}

fn ledger_directory(workspace: &Path, storage_base: &Path, run_id: &str, create: bool) -> Result<PathBuf, String> {
    if !valid_run_id(run_id) {
        return Err("无效运行编号".to_string());
    }
    let root = canonical_workspace(workspace)?;
    let directory = storage_root(&root, storage_base, create)?.join(RUN_LEDGER_DIR).join(run_id);
    if create {
        fs::create_dir_all(directory.join("blobs")).map_err(|e| format!("创建改动账本失败: {e}"))?;
    }
    Ok(directory)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".tmp-{:016x}", rand::random::<u64>()));
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        e.to_string()
    })
}

fn read_bounded(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
        Ok(metadata) if is_link(&metadata) || !metadata.is_file() => Err("改动跟踪不支持链接或特殊文件".to_string()),
        Ok(metadata) if metadata.len() > MAX_BLOB_BYTES => Err("文件超过改动跟踪的大小上限".to_string()),
        Ok(_) => fs::read(path).map(Some).map_err(|e| e.to_string()),
    }
}

impl ChangeLedger {
    /// 打开（或新建）某次运行的账本
    pub fn open(workspace: &Path, storage_base: &Path, run_id: &str) -> Result<Self, String> {
        let root = canonical_workspace(workspace)?;
        let directory = ledger_directory(&root, storage_base, run_id, false)?;
        let file = match fs::read(directory.join("ledger.json")) {
            Ok(bytes) => {
                let file: LedgerFile = serde_json::from_slice(&bytes).map_err(|e| format!("改动账本无效: {e}"))?;
                if file.version != LEDGER_VERSION || file.run_id != run_id || file.workspace != root.to_string_lossy() {
                    return Err("改动账本不属于该运行或工作区".to_string());
                }
                file
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => LedgerFile {
                version: LEDGER_VERSION,
                run_id: run_id.to_string(),
                workspace: root.to_string_lossy().to_string(),
                entries: BTreeMap::new(),
                updated_at: now_ms(),
            },
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self { workspace: root, storage_base: storage_base.to_path_buf(), directory, file })
    }

    pub fn run_id(&self) -> &str {
        &self.file.run_id
    }

    pub fn entries(&self) -> impl Iterator<Item = &LedgerEntry> {
        self.file.entries.values()
    }

    pub fn entry(&self, path: &str) -> Option<&LedgerEntry> {
        self.file.entries.get(path)
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    fn prepare_directory(&mut self) -> Result<(), String> {
        self.directory = ledger_directory(&self.workspace, &self.storage_base, &self.file.run_id, true)?;
        Ok(())
    }

    fn save(&mut self) -> Result<(), String> {
        self.prepare_directory()?;
        self.file.updated_at = now_ms();
        write_atomic(
            &self.directory.join("ledger.json"),
            &serde_json::to_vec(&self.file).map_err(|e| e.to_string())?,
        )
    }

    fn store_blob(&self, bytes: &[u8]) -> Result<(), String> {
        let path = self.directory.join("blobs").join(digest(bytes));
        if path.exists() {
            return Ok(());
        }
        write_atomic(&path, bytes)
    }

    /// 读取账本中保存的某个版本内容
    pub fn read_blob(&self, version: &FileVersion) -> Result<Option<Vec<u8>>, String> {
        let Some(hash) = version.digest.as_deref() else { return Ok(None) };
        if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("改动账本摘要无效".to_string());
        }
        let bytes = fs::read(self.directory.join("blobs").join(hash)).map_err(|e| format!("改动账本缺少版本内容: {e}"))?;
        if digest(&bytes) != hash {
            return Err("改动账本版本内容校验失败".to_string());
        }
        Ok(Some(bytes))
    }

    /// 读取工作区文件的当前版本
    pub fn current(&self, path: &str) -> Result<(FileVersion, Option<Vec<u8>>), String> {
        let target = crate::tools::fs::resolve_tool_path(path, &self.workspace)?;
        let bytes = read_bounded(&target)?;
        Ok((FileVersion::of(bytes.as_deref()), bytes))
    }

    /// 记录一次改动：基线只在第一次改动时确定，之后保持不变；运行写入后的版本每次更新
    fn record(&mut self, path: &str, baseline: Option<&[u8]>, source: ChangeSource, call_id: &str) -> Result<(), String> {
        let (agent, current) = self.current(path)?;
        self.prepare_directory()?;
        if let Some(bytes) = current.as_deref() {
            self.store_blob(bytes)?;
        }
        match self.file.entries.get_mut(path) {
            Some(entry) => {
                entry.agent = agent;
                entry.reviewed = None;
                if !entry.calls.iter().any(|call| call == call_id) {
                    entry.calls.push(call_id.to_string());
                }
            }
            None => {
                if let Some(bytes) = baseline {
                    self.store_blob(bytes)?;
                }
                self.file.entries.insert(
                    path.to_string(),
                    LedgerEntry {
                        path: path.to_string(),
                        baseline: FileVersion::of(baseline),
                        agent,
                        source,
                        calls: vec![call_id.to_string()],
                        reviewed: None,
                    },
                );
            }
        }
        // 改回了改动前的内容：不再是本次运行的改动
        if let Some(entry) = self.file.entries.get(path) {
            if entry.agent == entry.baseline {
                self.file.entries.remove(path);
            }
        }
        self.save()
    }

    /// 文件工具写入后记录；baseline 为写前读取的内容
    pub fn record_file_tool(&mut self, path: &str, baseline: Option<&[u8]>, call_id: &str) -> Result<(), String> {
        self.record(path, baseline, ChangeSource::FileTool, call_id)
    }

    /// 命令或 MCP 执行后记录观察到的改动；基线取本轮检查点中的内容
    pub fn record_observed(
        &mut self,
        paths: &[String],
        checkpoint: Option<(&CheckpointStore, &str)>,
        call_id: &str,
    ) -> Result<(), String> {
        for path in paths {
            let baseline = if self.file.entries.contains_key(path) {
                None
            } else {
                match checkpoint {
                    Some((store, id)) => store.read_file(id, path)?,
                    None => None,
                }
            };
            self.record(path, baseline.as_deref(), ChangeSource::Command, call_id)?;
        }
        Ok(())
    }

    /// 用户在审阅中处理完某个文件后记录处理后的版本，区分“已处理”与“之后被外部修改”
    pub fn mark_reviewed(&mut self, path: &str) -> Result<(), String> {
        let (current, bytes) = self.current(path)?;
        self.prepare_directory()?;
        if let Some(bytes) = bytes.as_deref() {
            self.store_blob(bytes)?;
        }
        let entry = self.file.entries.get_mut(path).ok_or("该文件不是本次运行的改动")?;
        entry.reviewed = Some(current);
        self.save()
    }
}

/// 写入文件工具目标前的内容（用作基线）；文件不存在时为 None
pub fn read_before_write(workspace: &Path, path: &str) -> Result<Option<Vec<u8>>, String> {
    let target = crate::tools::fs::resolve_tool_path(path, workspace)?;
    read_bounded(&target)
}

/// 文件工具参数中的目标路径，规范为工作区相对路径
pub fn tool_target(workspace: &Path, arguments: &serde_json::Value) -> Option<String> {
    let path = arguments.get("path")?.as_str()?;
    let target = crate::tools::fs::resolve_tool_path(path, workspace).ok()?;
    let root = canonical_workspace(workspace).ok()?;
    relative_string(&target, &root).ok()
}

/// 审阅视角下的文件状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeState {
    /// 当前内容就是本次运行写入的版本
    Agent,
    /// 用户已在审阅中处理，当前内容就是处理后的版本
    Reviewed,
    /// 当前内容已与改动前一致
    Reverted,
    /// 运行写入之后又被用户或其他任务修改，不能直接撤销
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub state: ChangeState,
    pub source: ChangeSource,
    pub calls: Vec<String>,
    pub baseline: FileVersion,
    pub current: FileVersion,
}

pub fn classify(entry: &LedgerEntry, current: &FileVersion) -> ChangeState {
    if *current == entry.agent {
        ChangeState::Agent
    } else if *current == entry.baseline {
        ChangeState::Reverted
    } else if entry.reviewed.as_ref() == Some(current) {
        ChangeState::Reviewed
    } else {
        ChangeState::Conflict
    }
}

pub fn kind_of(baseline: &FileVersion, current: &FileVersion, agent: &FileVersion) -> ChangeKind {
    let after = if current.present || !agent.present { current } else { agent };
    match (baseline.present, after.present) {
        (false, _) => ChangeKind::Added,
        (true, false) => ChangeKind::Deleted,
        (true, true) => ChangeKind::Modified,
    }
}

/// 列出某次运行的全部改动及其当前状态
pub fn list_changes(ledger: &ChangeLedger) -> Result<Vec<RunFileChange>, String> {
    let mut changes = Vec::new();
    for entry in ledger.entries() {
        let (current, _) = ledger.current(&entry.path)?;
        changes.push(RunFileChange {
            path: entry.path.clone(),
            kind: kind_of(&entry.baseline, &current, &entry.agent),
            state: classify(entry, &current),
            source: entry.source,
            calls: entry.calls.clone(),
            baseline: entry.baseline.clone(),
            current,
        });
    }
    Ok(changes)
}

/// 某个改动文件的审阅内容：改动前与当前的文本视图
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunChangeContent {
    pub change: RunFileChange,
    pub baseline: crate::tools::versioned::TextView,
    pub current: crate::tools::versioned::TextView,
}

fn ledger_exists(workspace: &Path, storage_base: &Path, run_id: &str) -> Result<bool, String> {
    Ok(ledger_directory(workspace, storage_base, run_id, false)?.join("ledger.json").exists())
}

/// 列出运行的改动；运行没有改动过文件时为空
pub fn run_changes(workspace: &Path, storage_base: &Path, run_id: &str) -> Result<Vec<RunFileChange>, String> {
    if !ledger_exists(workspace, storage_base, run_id)? {
        return Ok(Vec::new());
    }
    list_changes(&ChangeLedger::open(workspace, storage_base, run_id)?)
}

fn change_for(ledger: &ChangeLedger, path: &str) -> Result<(LedgerEntry, RunFileChange, crate::tools::versioned::FileSnapshot), String> {
    let entry = ledger.entry(path).cloned().ok_or("该文件不是本次运行的改动")?;
    let snapshot = crate::tools::versioned::read_snapshot(ledger.workspace(), path)?;
    let current = FileVersion::of(snapshot.bytes.as_deref());
    let change = RunFileChange {
        path: entry.path.clone(),
        kind: kind_of(&entry.baseline, &current, &entry.agent),
        state: classify(&entry, &current),
        source: entry.source,
        calls: entry.calls.clone(),
        baseline: entry.baseline.clone(),
        current,
    };
    Ok((entry, change, snapshot))
}

pub fn run_change_content(workspace: &Path, storage_base: &Path, run_id: &str, path: &str) -> Result<RunChangeContent, String> {
    let ledger = ChangeLedger::open(workspace, storage_base, run_id)?;
    let path = crate::tools::versioned::normalize_relative(workspace, path)?;
    let (entry, change, snapshot) = change_for(&ledger, &path)?;
    let baseline = crate::tools::versioned::FileSnapshot { bytes: ledger.read_blob(&entry.baseline)? };
    Ok(RunChangeContent {
        change,
        baseline: crate::tools::versioned::text_view(&baseline),
        current: crate::tools::versioned::text_view(&snapshot),
    })
}

/// 撤销本次运行对某个文件的改动。content 为 None 时整体恢复改动前的版本（新建的文件被删除），
/// 否则写入界面按所选块合并出的文本（只撤销所选块，其余保持现状）。
/// 运行写入之后又被他人修改的文件不允许撤销；当前版本与 expected 不一致时拒绝覆盖。
pub fn revert_run_change(
    workspace: &Path,
    storage_base: &Path,
    run_id: &str,
    path: &str,
    content: Option<&str>,
    expected: Option<&str>,
) -> Result<RunFileChange, String> {
    let mut ledger = ChangeLedger::open(workspace, storage_base, run_id)?;
    let path = crate::tools::versioned::normalize_relative(workspace, path)?;
    let (entry, change, snapshot) = change_for(&ledger, &path)?;
    if change.state == ChangeState::Conflict {
        return Err(format!(
            "{}: 文件 '{path}' 在本次运行写入后又被修改，不能直接撤销，请先查看差异。",
            crate::tools::versioned::VERSION_CONFLICT
        ));
    }
    let bytes = match content {
        None => ledger.read_blob(&entry.baseline)?,
        Some(text) => {
            let baseline = crate::tools::versioned::text_view(&crate::tools::versioned::FileSnapshot { bytes: ledger.read_blob(&entry.baseline)? });
            let current = crate::tools::versioned::text_view(&snapshot);
            if !baseline.lossless || !current.lossless {
                return Err("非 UTF-8 文本只能整体撤销".to_string());
            }
            Some(crate::tools::versioned::encode_text(text, current.bom))
        }
    };
    crate::tools::versioned::write_checked(workspace, storage_base, &path, bytes.as_deref(), expected)?;
    ledger.mark_reviewed(&path)?;
    Ok(change_for(&ledger, &path)?.1)
}

/// 批量撤销时的处理顺序：先恢复修改过的文件，再恢复被删除的文件，最后删除新建的文件。
/// 重命名表现为“删除旧路径 + 新建新路径”，旧内容先回到原位再删除新路径，中途失败也不会丢失内容。
fn revert_order(kind: ChangeKind) -> u8 {
    match kind {
        ChangeKind::Modified => 0,
        ChangeKind::Deleted => 1,
        ChangeKind::Added => 2,
    }
}

/// 整体撤销本次运行对多个文件的改动。items 为（路径，界面看到的当前版本摘要）。
/// 写入前先逐个核对：任何文件处于冲突或版本已变化时一个都不写；
/// 写入过程中若某个文件被并发修改而失败，已撤销的文件保持撤销并记入错误说明，其余不再处理。
pub fn revert_run_changes(
    workspace: &Path,
    storage_base: &Path,
    run_id: &str,
    items: &[(String, Option<String>)],
) -> Result<Vec<RunFileChange>, String> {
    let mut ledger = ChangeLedger::open(workspace, storage_base, run_id)?;
    let mut plan = Vec::with_capacity(items.len());
    for (path, expected) in items {
        let path = crate::tools::versioned::normalize_relative(workspace, path)?;
        let (entry, change, snapshot) = change_for(&ledger, &path)?;
        if change.state == ChangeState::Conflict {
            return Err(format!(
                "{}: 文件 '{path}' 在本次运行写入后又被修改，不能直接撤销，请先查看差异。没有撤销任何文件。",
                crate::tools::versioned::VERSION_CONFLICT
            ));
        }
        if snapshot.digest() != *expected {
            return Err(format!(
                "{}: 文件 '{path}' 已在别处被修改，请刷新后再处理。没有撤销任何文件。",
                crate::tools::versioned::VERSION_CONFLICT
            ));
        }
        plan.push((revert_order(change.kind), path, entry, expected.clone()));
    }
    plan.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let mut reverted: Vec<String> = Vec::new();
    for (_, path, entry, expected) in &plan {
        let result = ledger
            .read_blob(&entry.baseline)
            .and_then(|bytes| crate::tools::versioned::write_checked(workspace, storage_base, path, bytes.as_deref(), expected.as_deref()))
            .and_then(|_| ledger.mark_reviewed(path));
        if let Err(error) = result {
            let done = if reverted.is_empty() { "没有撤销任何文件".to_string() } else { format!("已撤销 {}", reverted.join("、")) };
            return Err(format!("{error}（{done}；'{path}' 及之后的文件未处理）"));
        }
        reverted.push(path.clone());
    }
    plan.iter().map(|(_, path, _, _)| change_for(&ledger, path).map(|(_, change, _)| change)).collect()
}

/// 保留本次运行对某个文件的改动：记录用户已处理，之后被修改会以冲突呈现
pub fn keep_run_change(workspace: &Path, storage_base: &Path, run_id: &str, path: &str, expected: Option<&str>) -> Result<RunFileChange, String> {
    let mut ledger = ChangeLedger::open(workspace, storage_base, run_id)?;
    let path = crate::tools::versioned::normalize_relative(workspace, path)?;
    let (_, change, snapshot) = change_for(&ledger, &path)?;
    if snapshot.digest().as_deref() != expected {
        return Err(format!("{}: 文件 '{path}' 已在别处被修改，请刷新后再处理。", crate::tools::versioned::VERSION_CONFLICT));
    }
    if change.state == ChangeState::Conflict {
        return Err(format!("{}: 文件 '{path}' 在本次运行写入后又被修改。", crate::tools::versioned::VERSION_CONFLICT));
    }
    ledger.mark_reviewed(&path)?;
    Ok(change_for(&ledger, &path)?.1)
}

/// 把文件恢复为本次运行写入的版本（撤销之后反悔时使用），同样核对当前版本
pub fn restore_agent_version(workspace: &Path, storage_base: &Path, run_id: &str, path: &str, expected: Option<&str>) -> Result<RunFileChange, String> {
    let ledger = ChangeLedger::open(workspace, storage_base, run_id)?;
    let path = crate::tools::versioned::normalize_relative(workspace, path)?;
    let entry = ledger.entry(&path).cloned().ok_or("该文件不是本次运行的改动")?;
    let bytes = ledger.read_blob(&entry.agent)?;
    crate::tools::versioned::write_checked(workspace, storage_base, &path, bytes.as_deref(), expected)?;
    Ok(change_for(&ledger, &path)?.1)
}
