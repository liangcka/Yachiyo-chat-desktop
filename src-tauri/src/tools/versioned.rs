//! 界面发起的文件读写：读取返回原始内容摘要，写入前核对摘要，覆盖前把原内容存入备份。
//! 编辑器保存与任务审阅撤销都走这里，外部修改过的文件不会被盲目覆盖。
use crate::gateway::agent::checkpoint::{canonical_workspace, digest, is_link, relative_string, storage_root, UI_BACKUP_DIR};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// 每个工作区保留的界面写入备份条数
const MAX_BACKUPS: usize = 200;
const UTF8_BOM: &[u8] = &[0xef, 0xbb, 0xbf];

/// 文件的一个版本：内容以字节保存，摘要用于写入前的版本核对
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSnapshot {
    pub bytes: Option<Vec<u8>>,
}

impl FileSnapshot {
    pub fn digest(&self) -> Option<String> {
        self.bytes.as_deref().map(digest)
    }
}

/// 解码后的文本视图；lossless 为 false 时不是 UTF-8，界面只能只读查看或整体替换
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextView {
    pub present: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    pub lossless: bool,
    pub bom: bool,
}

pub fn text_view(snapshot: &FileSnapshot) -> TextView {
    match snapshot.bytes.as_deref() {
        None => TextView { present: false, content: String::new(), digest: None, lossless: true, bom: false },
        Some(bytes) => {
            let bom = bytes.starts_with(UTF8_BOM);
            let body = if bom { &bytes[UTF8_BOM.len()..] } else { bytes };
            let (content, lossless) = match std::str::from_utf8(body) {
                Ok(text) => (text.to_string(), !text.contains('\0')),
                Err(_) => (crate::tools::fs::decode_file_bytes(bytes), false),
            };
            TextView { present: true, content, digest: Some(digest(bytes)), lossless, bom }
        }
    }
}

/// 把界面给出的文本编码回字节，保留原文件的 UTF-8 BOM
pub fn encode_text(text: &str, bom: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() + 3);
    if bom {
        bytes.extend_from_slice(UTF8_BOM);
    }
    bytes.extend_from_slice(text.as_bytes());
    bytes
}

pub fn read_snapshot(workspace: &Path, path: &str) -> Result<FileSnapshot, String> {
    let target = crate::tools::fs::resolve_tool_path(path, workspace)?;
    read_target(&target)
}

fn read_target(target: &Path) -> Result<FileSnapshot, String> {
    match fs::symlink_metadata(target) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileSnapshot { bytes: None }),
        Err(error) => Err(error.to_string()),
        Ok(metadata) if is_link(&metadata) || !metadata.is_file() => Err("不支持链接或特殊文件".to_string()),
        Ok(metadata) if metadata.len() > MAX_FILE_BYTES => Err("文件超过 32 MiB，不能在界面中编辑".to_string()),
        Ok(_) => fs::read(target).map(|bytes| FileSnapshot { bytes: Some(bytes) }).map_err(|e| e.to_string()),
    }
}

pub const VERSION_CONFLICT: &str = "FILE_VERSION_CONFLICT";

/// 写入（或删除）文件：当前版本必须与调用方看到的版本一致，否则拒绝覆盖并报告冲突。
/// 覆盖或删除之前，把原内容存入备份，界面可以据此恢复。返回写入后的摘要（删除时为 None）
pub fn write_checked(
    workspace: &Path,
    storage_base: &Path,
    path: &str,
    content: Option<&[u8]>,
    expected: Option<&str>,
) -> Result<Option<String>, String> {
    let target = crate::tools::fs::resolve_tool_path(path, workspace)?;
    let current = read_target(&target)?;
    if current.digest().as_deref() != expected {
        return Err(format!("{VERSION_CONFLICT}: 文件 '{path}' 已在别处被修改，为避免覆盖他人的改动已停止写入。请重新加载后再操作。"));
    }
    if current.bytes.as_deref() == content {
        return Ok(current.digest());
    }
    if let Some(previous) = current.bytes.as_deref() {
        BackupStore::open(workspace, storage_base)?.save(path, previous)?;
    }
    match content {
        Some(bytes) => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let temporary = target.with_file_name(format!(".yachiyo-write-{:016x}", rand::random::<u64>()));
            fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
            if current.bytes.is_some() {
                if let Ok(metadata) = fs::metadata(&target) {
                    let _ = fs::set_permissions(&temporary, metadata.permissions());
                }
            }
            fs::rename(&temporary, &target).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("写入文件失败: {error}")
            })?;
            Ok(Some(digest(bytes)))
        }
        None => {
            if current.bytes.is_some() {
                fs::remove_file(&target).map_err(|e| format!("删除文件失败: {e}"))?;
            }
            Ok(None)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub path: String,
    pub digest: String,
    pub created_at: u64,
}

/// 界面覆盖写入前的备份：内容按摘要存放，索引只保留最近的若干条
pub struct BackupStore {
    workspace: PathBuf,
    directory: PathBuf,
}

impl BackupStore {
    pub fn open(workspace: &Path, storage_base: &Path) -> Result<Self, String> {
        let root = canonical_workspace(workspace)?;
        let directory = storage_root(&root, storage_base, true)?.join(UI_BACKUP_DIR);
        fs::create_dir_all(directory.join("blobs")).map_err(|e| format!("创建备份目录失败: {e}"))?;
        Ok(Self { workspace: root, directory })
    }

    fn index(&self) -> Vec<BackupEntry> {
        fs::read(self.directory.join("index.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &str, bytes: &[u8]) -> Result<BackupEntry, String> {
        let hash = digest(bytes);
        let blob = self.directory.join("blobs").join(&hash);
        if !blob.exists() {
            fs::write(&blob, bytes).map_err(|e| format!("保存备份失败: {e}"))?;
        }
        let created_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let entry = BackupEntry { id: format!("{created_at}-{:08x}", rand::random::<u32>()), path: path.to_string(), digest: hash, created_at };
        let mut index = self.index();
        index.push(entry.clone());
        if index.len() > MAX_BACKUPS {
            index.drain(..index.len() - MAX_BACKUPS);
        }
        let temporary = self.directory.join(format!(".index-{:016x}", rand::random::<u64>()));
        fs::write(&temporary, serde_json::to_vec(&index).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(&temporary, self.directory.join("index.json")).map_err(|e| e.to_string())?;
        Ok(entry)
    }

    /// 某个文件的备份，按时间倒序
    pub fn list(&self, path: &str) -> Vec<BackupEntry> {
        let mut entries: Vec<BackupEntry> = self.index().into_iter().filter(|entry| entry.path == path).collect();
        entries.reverse();
        entries
    }

    pub fn read(&self, id: &str) -> Result<(BackupEntry, Vec<u8>), String> {
        let entry = self.index().into_iter().find(|entry| entry.id == id).ok_or("备份不存在")?;
        let bytes = fs::read(self.directory.join("blobs").join(&entry.digest)).map_err(|e| format!("读取备份失败: {e}"))?;
        if digest(&bytes) != entry.digest {
            return Err("备份内容校验失败".to_string());
        }
        Ok((entry, bytes))
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }
}

/// 工作区相对路径的规范写法，供账本与备份按同一键查找
pub fn normalize_relative(workspace: &Path, path: &str) -> Result<String, String> {
    let target = crate::tools::fs::resolve_tool_path(path, workspace)?;
    let root = canonical_workspace(workspace)?;
    relative_string(&target, &root)
}
