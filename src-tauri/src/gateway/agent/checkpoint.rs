use crate::tools::fs::resolve_in_workspace;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointManifestEntry {
    pub sequence: u32,
    /// 工作区相对路径（原文件）
    pub original: String,
    /// 工作区相对路径（备份文件）
    pub backup: String,
}

/// 单次 Agent 运行的写前影子备份；rollback_all 按逆序恢复
pub struct CheckpointStore {
    workspace_root: PathBuf,
    run_id: String,
    entries: Vec<CheckpointManifestEntry>,
    sequence: u32,
}

impl CheckpointStore {
    pub fn new(workspace_root: &Path, run_id: &str) -> Self {
        Self {
            workspace_root: workspace_root.to_path_buf(),
            run_id: run_id.to_string(),
            entries: Vec::new(),
            sequence: 0,
        }
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn entries(&self) -> &[CheckpointManifestEntry] {
        &self.entries
    }

    /// write_file 执行前调用；目标存在且不在 .yachiyo/ 内时备份，返回是否产生备份
    pub fn backup_before_write(&mut self, path_str: &str) -> Result<bool, String> {
        let target = resolve_in_workspace(path_str, &self.workspace_root)?;
        if !target.exists() || !target.is_file() {
            return Ok(false);
        }
        let relative = target
            .strip_prefix(&self.workspace_root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| target.to_string_lossy().to_string());
        if relative.starts_with(".yachiyo") {
            return Ok(false);
        }

        self.sequence += 1;
        let backup_rel = format!(
            ".yachiyo/checkpoints/{}/{}__{}",
            self.run_id,
            self.sequence,
            relative.replace(['\\', '/'], "__")
        );
        let backup_abs = self.workspace_root.join(&backup_rel);
        if let Some(parent) = backup_abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {}", e))?;
        }
        std::fs::copy(&target, &backup_abs).map_err(|e| format!("备份文件失败: {}", e))?;

        self.entries.push(CheckpointManifestEntry {
            sequence: self.sequence,
            original: relative,
            backup: backup_rel,
        });
        Ok(true)
    }

    /// 逆序恢复全部备份，返回恢复数量
    pub fn rollback_all(&self) -> Result<usize, String> {
        let mut restored = 0;
        for entry in self.entries.iter().rev() {
            let backup_abs = self.workspace_root.join(&entry.backup);
            let original_abs = self.workspace_root.join(&entry.original);
            match std::fs::copy(&backup_abs, &original_abs) {
                Ok(_) => restored += 1,
                Err(e) => return Err(format!("回滚 {} 失败: {}", entry.original, e)),
            }
        }
        Ok(restored)
    }

    /// 确保 workspace 的 .gitignore 忽略 .yachiyo/（不存在则创建，幂等追加）
    pub fn ensure_gitignore(&self) -> Result<(), String> {
        let gitignore = self.workspace_root.join(".gitignore");
        let marker = ".yachiyo/";
        let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
        if existing.lines().any(|line| line.trim() == marker) {
            return Ok(());
        }
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(marker);
        next.push('\n');
        std::fs::write(&gitignore, next).map_err(|e| format!("写入 .gitignore 失败: {}", e))
    }
}
