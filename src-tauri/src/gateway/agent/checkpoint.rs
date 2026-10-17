use crate::tools::fs::resolve_tool_path;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_FILES: usize = 20_000;
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    ".yachiyo",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub created_at: u64,
    pub turn: u32,
    pub run_id: String,
}

#[derive(Serialize, Deserialize)]
struct SnapshotFile {
    path: String,
    bytes: u64,
    digest: String,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    workspace: String,
    checkpoint: Checkpoint,
    files: Vec<SnapshotFile>,
    directories: Vec<String>,
}

pub struct CheckpointStore {
    workspace_root: PathBuf,
    storage_base: PathBuf,
    run_id: String,
    entries: Vec<Checkpoint>,
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn canonical_workspace(root: &Path) -> Result<PathBuf, String> {
    let canonical = root
        .canonicalize()
        .map_err(|e| format!("工作区不可用: {e}"))?;
    if !canonical.is_dir() {
        return Err("工作区不是目录".to_string());
    }
    Ok(canonical)
}

pub(crate) fn default_storage_base() -> PathBuf {
    crate::crypto::keys::dirs_storage_path().join("checkpoints")
}

fn canonical_storage_base(base: &Path) -> Result<PathBuf, String> {
    let absolute = if base.is_absolute() {
        base.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(base)
    };
    let mut missing = Vec::new();
    let mut ancestor = absolute.as_path();
    while !ancestor.exists() {
        if let Ok(metadata) = fs::symlink_metadata(ancestor) {
            if is_link(&metadata) {
                return Err("检查点存储路径不得包含链接".to_string());
            }
        }
        missing.push(
            ancestor
                .file_name()
                .ok_or("检查点存储路径无效")?
                .to_os_string(),
        );
        ancestor = ancestor.parent().ok_or("检查点存储路径无效")?;
    }
    for component in ancestor.ancestors() {
        let metadata = fs::symlink_metadata(component).map_err(|e| e.to_string())?;
        if is_link(&metadata) || !metadata.is_dir() {
            return Err("检查点存储路径不得包含链接或普通文件".to_string());
        }
    }
    let mut canonical = ancestor.canonicalize().map_err(|e| e.to_string())?;
    for component in missing.into_iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

pub(crate) fn is_private_storage_path(path: &Path) -> bool {
    canonical_storage_base(&default_storage_base())
        .map(|base| path.starts_with(base))
        .unwrap_or(false)
}

fn storage_root(root: &Path, base: &Path, create: bool) -> Result<PathBuf, String> {
    let base = canonical_storage_base(base)?;
    if base.starts_with(root) || root.starts_with(&base) {
        return Err("工作区与检查点存储范围重叠，请选择更具体的项目目录。".to_string());
    }
    if create {
        fs::create_dir_all(&base).map_err(|e| format!("创建检查点目录失败: {e}"))?;
    }
    let path = base.join(digest(root.to_string_lossy().as_bytes()));
    match fs::symlink_metadata(&path) {
        Ok(metadata) if is_link(&metadata) || !metadata.is_dir() => {
            return Err("检查点存储路径不得为链接或普通文件".to_string())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if create {
                fs::create_dir(&path).map_err(|e| format!("创建检查点目录失败: {e}"))?;
            }
        }
        Err(error) => return Err(error.to_string()),
    }
    Ok(path)
}

fn relative_string(path: &Path, root: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "检查点文件越出工作区".to_string())
}

fn excluded(name: &std::ffi::OsStr) -> bool {
    EXCLUDED_DIRS
        .iter()
        .any(|excluded| name.to_string_lossy().eq_ignore_ascii_case(excluded))
}

fn snapshot_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty()
        || path.is_absolute()
        || relative.contains('\\')
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)) || excluded(part.as_os_str()))
    {
        return Err("检查点清单包含无效文件路径".to_string());
    }
    #[cfg(windows)]
    if relative
        .split('/')
        .any(|component| component.contains(':') || component.ends_with(['.', ' ']))
    {
        return Err("检查点清单包含无效 Windows 文件路径".to_string());
    }
    resolve_tool_path(relative, root)
}

fn path_key(path: &str) -> String {
    #[cfg(windows)]
    {
        path.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.to_string()
    }
}

fn inventory(root: &Path) -> Result<(Vec<PathBuf>, Vec<String>), String> {
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut bytes = 0_u64;
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).map_err(|e| format!("读取工作区失败: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if excluded(&entry.file_name()) {
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if is_link(&metadata) {
                return Err(format!(
                    "检查点不跟随符号链接，请先移除或移出快照范围: {}",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                directories.push(relative_string(&path, root)?);
                stack.push(path);
            } else if metadata.is_file() {
                bytes = bytes.checked_add(metadata.len()).ok_or("检查点大小溢出")?;
                files.push(path);
            } else {
                return Err("检查点不支持特殊文件".to_string());
            }
            if files.len() + directories.len() > MAX_FILES || bytes > MAX_BYTES {
                return Err("工作区快照超过 20000 个条目或 256 MiB，已停止执行写操作。".to_string());
            }
        }
    }
    files.sort();
    directories.sort();
    Ok((files, directories))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("检查点文件超过大小限制".to_string());
    }
    Ok(bytes)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn load_manifest(root: &Path, base: &Path, id: &str) -> Result<(PathBuf, Manifest), String> {
    if !valid_id(id) {
        return Err("无效检查点编号".to_string());
    }
    let directory = storage_root(root, base, false)?.join(id);
    for path in [&directory, &directory.join("manifest.json")] {
        if is_link(&fs::symlink_metadata(path).map_err(|e| e.to_string())?) {
            return Err("检查点存储不得包含链接".to_string());
        }
    }
    let manifest_path = directory.join("manifest.json");
    if fs::metadata(&manifest_path)
        .map_err(|e| e.to_string())?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("检查点清单过大".to_string());
    }
    let manifest: Manifest =
        serde_json::from_slice(&read_limited(&manifest_path, 8 * 1024 * 1024)?)
            .map_err(|e| format!("检查点清单无效: {e}"))?;
    if manifest.version != 1
        || manifest.workspace != root.to_string_lossy()
        || manifest.checkpoint.id != id
        || manifest.files.len() + manifest.directories.len() > MAX_FILES
        || manifest.checkpoint.turn == 0
        || manifest.checkpoint.run_id.trim().is_empty()
        || manifest.checkpoint.created_at > 8_640_000_000_000_000
    {
        return Err("检查点不属于当前工作区或格式不受支持".to_string());
    }
    let mut paths = HashSet::new();
    let mut total = 0_u64;
    for file in &manifest.files {
        snapshot_path(root, &file.path)?;
        if !paths.insert(path_key(&file.path)) {
            return Err("检查点清单包含重复路径".to_string());
        }
        total = total.checked_add(file.bytes).ok_or("检查点大小溢出")?;
    }
    for directory in &manifest.directories {
        snapshot_path(root, directory)?;
        if !paths.insert(path_key(directory)) {
            return Err("检查点清单包含冲突路径".to_string());
        }
    }
    let directories: HashSet<_> = manifest
        .directories
        .iter()
        .map(|path| path_key(path))
        .collect();
    for path in manifest
        .files
        .iter()
        .map(|file| file.path.as_str())
        .chain(manifest.directories.iter().map(String::as_str))
    {
        if let Some((parent, _)) = path.rsplit_once('/') {
            if !directories.contains(&path_key(parent)) {
                return Err("检查点清单缺少父目录或存在文件目录冲突".to_string());
            }
        }
    }
    if total > MAX_BYTES {
        return Err("检查点大小超过限制".to_string());
    }
    Ok((directory, manifest))
}

impl CheckpointStore {
    pub fn new(workspace_root: &Path, run_id: &str) -> Self {
        Self::with_storage(workspace_root, run_id, &default_storage_base())
    }
    pub fn with_storage(workspace_root: &Path, run_id: &str, storage_base: &Path) -> Self {
        Self {
            workspace_root: workspace_root.to_path_buf(),
            storage_base: storage_base.to_path_buf(),
            run_id: run_id.to_string(),
            entries: Vec::new(),
        }
    }
    pub fn run_id(&self) -> &str {
        &self.run_id
    }
    pub fn entries(&self) -> &[Checkpoint] {
        &self.entries
    }
    pub fn storage_directory(&self) -> Result<PathBuf, String> {
        storage_root(
            &canonical_workspace(&self.workspace_root)?,
            &self.storage_base,
            false,
        )
    }

    /// 先完成快照再允许副作用；失败的半成品不进入可恢复列表。
    pub fn capture_turn(&mut self, turn: u32) -> Result<Checkpoint, String> {
        if turn == 0 || self.run_id.trim().is_empty() {
            return Err("检查点轮次或运行编号无效".to_string());
        }
        let root = canonical_workspace(&self.workspace_root)?;
        let (files, directories) = inventory(&root)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        let created_at = Self::list_with_storage(&root, &self.storage_base)?
            .first()
            .map(|checkpoint| now.max(checkpoint.created_at + 1))
            .unwrap_or(now);
        let checkpoint = Checkpoint {
            id: format!("{created_at}-{:016x}", rand::random::<u64>()),
            created_at,
            turn,
            run_id: self.run_id.clone(),
        };
        let storage = storage_root(&root, &self.storage_base, true)?;
        let pending = storage.join(format!("pending-{}", checkpoint.id));
        fs::create_dir(&pending).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut entries = Vec::new();
            let mut total = 0_u64;
            for (index, source) in files.iter().enumerate() {
                let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
                if is_link(&metadata)
                    || !metadata.is_file()
                    || !source
                        .canonicalize()
                        .map_err(|e| e.to_string())?
                        .starts_with(&root)
                {
                    return Err("快照期间工作区文件路径发生变化".to_string());
                }
                let bytes = read_limited(source, MAX_BYTES - total)?;
                total += bytes.len() as u64;
                if total > MAX_BYTES {
                    return Err("工作区快照超过 256 MiB".to_string());
                }
                fs::write(pending.join(index.to_string()), &bytes).map_err(|e| e.to_string())?;
                entries.push(SnapshotFile {
                    path: relative_string(source, &root)?,
                    bytes: bytes.len() as u64,
                    digest: digest(&bytes),
                });
            }
            let manifest = Manifest {
                version: 1,
                workspace: root.to_string_lossy().to_string(),
                checkpoint: checkpoint.clone(),
                files: entries,
                directories,
            };
            fs::write(
                pending.join("manifest.json"),
                serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            fs::rename(&pending, storage.join(&checkpoint.id)).map_err(|e| e.to_string())
        })();
        if result.is_err()
            && pending.parent() == Some(storage.as_path())
            && !is_link(&fs::symlink_metadata(&pending).map_err(|e| e.to_string())?)
        {
            let _ = fs::remove_dir_all(&pending);
        }
        result?;
        self.entries.push(checkpoint.clone());
        Ok(checkpoint)
    }

    /// 保留内部逐文件调用入口，其保护范围现在是整个工作区快照。
    pub fn backup_before_write(&mut self, path: &str) -> Result<bool, String> {
        resolve_tool_path(path, &self.workspace_root)?;
        self.capture_turn(self.entries.len() as u32 + 1)?;
        Ok(true)
    }

    pub fn rollback_all(&self) -> Result<usize, String> {
        if let Some(checkpoint) = self.entries.first() {
            Self::restore_with_storage(&self.workspace_root, &checkpoint.id, &self.storage_base)?;
        }
        Ok(self.entries.len())
    }

    pub fn list(workspace_root: &Path) -> Result<Vec<Checkpoint>, String> {
        Self::list_with_storage(workspace_root, &default_storage_base())
    }
    pub fn list_with_storage(
        workspace_root: &Path,
        storage_base: &Path,
    ) -> Result<Vec<Checkpoint>, String> {
        let root = canonical_workspace(workspace_root)?;
        let storage = storage_root(&root, storage_base, false)?;
        if !storage.exists() {
            return Ok(Vec::new());
        }
        let mut checkpoints = Vec::new();
        for entry in fs::read_dir(storage).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().to_string();
            if id.starts_with("pending-") {
                continue;
            }
            let (_, manifest) = load_manifest(&root, storage_base, &id)?;
            checkpoints.push(manifest.checkpoint);
        }
        checkpoints.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(checkpoints)
    }

    /// 恢复前先验证全部备份，任何清单或内容损坏都不会触发文件删除。
    pub fn restore(workspace_root: &Path, id: &str) -> Result<(), String> {
        Self::restore_with_storage(workspace_root, id, &default_storage_base())
    }
    pub fn restore_with_storage(
        workspace_root: &Path,
        id: &str,
        storage_base: &Path,
    ) -> Result<(), String> {
        let root = canonical_workspace(workspace_root)?;
        let (directory, manifest) = load_manifest(&root, storage_base, id)?;
        let (current_files, mut current_directories) = inventory(&root)?;
        let mut contents = Vec::new();
        for (index, file) in manifest.files.iter().enumerate() {
            let backup = directory.join(index.to_string());
            let metadata = fs::symlink_metadata(&backup).map_err(|e| e.to_string())?;
            if is_link(&metadata) || !metadata.is_file() || metadata.len() != file.bytes {
                return Err("检查点备份文件无效".to_string());
            }
            let bytes = read_limited(&backup, file.bytes)?;
            if bytes.len() as u64 != file.bytes || digest(&bytes) != file.digest {
                return Err("检查点备份校验失败".to_string());
            }
            contents.push(bytes);
        }
        let wanted_files: HashSet<_> = manifest
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        let wanted_directories: HashSet<_> =
            manifest.directories.iter().map(String::as_str).collect();
        for file in current_files {
            if !wanted_files.contains(relative_string(&file, &root)?.as_str()) {
                fs::remove_file(&file).map_err(|e| format!("删除新建文件失败: {e}"))?;
            }
        }
        current_directories.sort_by_key(|path| std::cmp::Reverse(path.len()));
        for path in current_directories {
            if !wanted_directories.contains(path.as_str()) {
                let target = snapshot_path(&root, &path)?;
                match fs::remove_dir(&target) {
                    Ok(()) => {}
                    Err(_)
                        if fs::read_dir(&target)
                            .map(|mut entries| entries.next().is_some())
                            .unwrap_or(false) => {}
                    Err(error) => return Err(error.to_string()),
                }
            }
        }
        for path in &manifest.directories {
            fs::create_dir_all(snapshot_path(&root, path)?).map_err(|e| e.to_string())?;
        }
        for (file, bytes) in manifest.files.iter().zip(contents) {
            let target = snapshot_path(&root, &file.path)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            // 替换目录项，避免覆盖硬链接时同时改写工作区外的同一 inode。
            let temporary =
                target.with_file_name(format!(".yachiyo-restore-{:016x}", rand::random::<u64>()));
            use std::io::Write;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            let result = output.write_all(&bytes).map_err(|e| e.to_string());
            drop(output);
            if let Err(error) =
                result.and_then(|_| fs::rename(&temporary, &target).map_err(|e| e.to_string()))
            {
                let _ = fs::remove_file(&temporary);
                return Err(error);
            }
        }
        Ok(())
    }
}
