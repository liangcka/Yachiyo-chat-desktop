use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

pub fn is_path_inside_workspace(target: &Path, workspace_root: &Path) -> bool {
    let canonical_root = match workspace_root.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };

    // If target doesn't exist yet (for write_file), find the closest existing ancestor
    let canonical_target = if target.exists() {
        match target.canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        }
    } else {
        let mut curr = target;
        let mut non_existing_parts = Vec::new();
        while !curr.exists() {
            if let Some(name) = curr.file_name() {
                non_existing_parts.push(name);
            }
            if let Some(parent) = curr.parent() {
                if parent.as_os_str().is_empty() {
                    break;
                }
                curr = parent;
            } else {
                break;
            }
        }
        let canonical_ancestor = match curr.canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        };
        let mut full = canonical_ancestor;
        for part in non_existing_parts.into_iter().rev() {
            full.push(part);
        }
        full
    };

    canonical_target.starts_with(&canonical_root)
}

/// 相对路径基于工作区根解析、绝对路径原样保留；不含越界校验（由调用方决定）
pub fn resolve_in_workspace(path_str: &str, workspace_root: &Path) -> Result<PathBuf, String> {
    let target = PathBuf::from(path_str);
    Ok(if target.is_relative() {
        workspace_root.join(target)
    } else {
        target
    })
}

/// 对齐 DSH fs-observation-policy 规约：
/// 追踪会话内文件读取版本，在写入时强制“编辑前先读 (Read-before-edit)”与 CAS 乐观锁防篡改。
#[derive(Debug, Default, Clone)]
pub struct FsObservationTracker {
    observed: Arc<RwLock<HashMap<PathBuf, SystemTime>>>,
}

impl FsObservationTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_read(&self, canonical_path: &Path, mtime: SystemTime) {
        if let Ok(mut map) = self.observed.write() {
            map.insert(canonical_path.to_path_buf(), mtime);
        }
    }

    pub fn check_write(&self, canonical_target: &Path, exists: bool) -> Result<(), String> {
        if !exists {
            // 新建文件允许直接创建 (createIfAbsent)
            return Ok(());
        }

        let map = self.observed.read().map_err(|e| e.to_string())?;
        match map.get(canonical_target) {
            None => Err(format!(
                "FS_NOT_OBSERVED: edit/overwrite requires reading '{}' first — read the file, then retry.",
                canonical_target.display()
            )),
            Some(&observed_mtime) => {
                if let Ok(metadata) = fs::metadata(canonical_target) {
                    if let Ok(current_mtime) = metadata.modified() {
                        if current_mtime > observed_mtime {
                            return Err(format!(
                                "FS_STALE_VERSION: file '{}' has been modified since it was last read — re-read the file, then retry.",
                                canonical_target.display()
                            ));
                        }
                    }
                }
                Ok(())
            }
        }
    }

    pub fn record_write(&self, canonical_target: &Path, mtime: SystemTime) {
        if let Ok(mut map) = self.observed.write() {
            map.insert(canonical_target.to_path_buf(), mtime);
        }
    }
}

/// 安全解码文件字节流，支持 UTF-8（带/不带 BOM）、UTF-16 LE/BE、GBK/GB18030 及非标准编码容错
pub fn decode_file_bytes(bytes: &[u8]) -> String {
    // 1. 若有 BOM（UTF-8, UTF-16LE, UTF-16BE），依据 BOM 精确解码并剥除 BOM
    if let Some((encoding, bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
        let (cow, _, _) = encoding.decode(&bytes[bom_len..]);
        return cow.into_owned();
    }

    // 2. 尝试标准纯 UTF-8 校验与解码
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }

    // 3. 启发式检测 Windows 下常见的无 BOM UTF-16LE（例如某些 PowerShell 5.1 或 Windows 控制台导出的文本）
    if bytes.len() >= 4 && bytes.len() % 2 == 0 {
        let sample_chunks = bytes.chunks_exact(2).take(64);
        let mut zero_high_bytes = 0;
        let mut total_samples = 0;
        for chunk in sample_chunks {
            total_samples += 1;
            if chunk[1] == 0 && chunk[0] < 128 {
                zero_high_bytes += 1;
            }
        }
        if total_samples > 0 && (zero_high_bytes as f32 / total_samples as f32) >= 0.7 {
            let (cow, _, had_errors) = encoding_rs::UTF_16LE.decode(bytes);
            if !had_errors {
                return cow.into_owned();
            }
        }
    }

    // 4. 尝试中文 Windows 默认 ANSI/OEM 编码（GB18030 向上兼容 GBK 与 GB2312）
    let (cow, _, had_errors) = encoding_rs::GB18030.decode(bytes);
    if !had_errors {
        return cow.into_owned();
    }

    // 5. 兜底容错：UTF-8 lossy 解码，避免崩溃并尽可能恢复可见字符
    String::from_utf8_lossy(bytes).into_owned()
}

pub fn read_file(path_str: &str, workspace_root: &Path) -> Result<String, String> {
    read_file_guarded(path_str, workspace_root, None)
}

pub fn read_file_guarded(
    path_str: &str,
    workspace_root: &Path,
    tracker: Option<&FsObservationTracker>,
) -> Result<String, String> {
    let resolved = resolve_in_workspace(path_str, workspace_root)?;

    if !is_path_inside_workspace(&resolved, workspace_root) {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }

    let raw_bytes = fs::read(&resolved).map_err(|e| format!("Failed to read file '{}': {}", path_str, e))?;
    let content = decode_file_bytes(&raw_bytes);

    if let Some(t) = tracker {
        if let Ok(canonical) = resolved.canonicalize() {
            let mtime = fs::metadata(&canonical)
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            t.record_read(&canonical, mtime);
        }
    }

    Ok(content)
}

pub fn write_file(path_str: &str, content: &str, workspace_root: &Path) -> Result<String, String> {
    write_file_guarded(path_str, content, workspace_root, None)
}

pub fn write_file_guarded(
    path_str: &str,
    content: &str,
    workspace_root: &Path,
    tracker: Option<&FsObservationTracker>,
) -> Result<String, String> {
    let resolved = resolve_in_workspace(path_str, workspace_root)?;

    if !is_path_inside_workspace(&resolved, workspace_root) {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }

    let exists = resolved.exists();
    let canonical = if exists {
        resolved.canonicalize().map_err(|e| e.to_string())?
    } else {
        resolved.clone()
    };

    if let Some(t) = tracker {
        t.check_write(&canonical, exists)?;
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    fs::write(&resolved, content)
        .map_err(|e| format!("Failed to write file '{}': {}", path_str, e))?;

    if let Some(t) = tracker {
        let current_mtime = fs::metadata(&resolved)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let final_canonical = resolved.canonicalize().unwrap_or(resolved.clone());
        t.record_write(&final_canonical, current_mtime);
    }

    Ok(format!("Successfully wrote {} bytes to '{}'", content.len(), path_str))
}


/// UI 文件树专用：结构化目录条目（替代 list_directory 的 `/` 后缀字符串协议）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub is_dir: bool,
}

pub fn list_workspace_entries(
    path_str: &str,
    workspace_root: &Path,
) -> Result<Vec<WorkspaceEntry>, String> {
    let target = if path_str.is_empty() || path_str == "." {
        workspace_root.to_path_buf()
    } else {
        resolve_in_workspace(path_str, workspace_root)?
    };

    if !is_path_inside_workspace(&target, workspace_root) {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }

    let entries = fs::read_dir(&target).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut results: Vec<WorkspaceEntry> = entries
        .flatten()
        .map(|entry| WorkspaceEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        })
        .collect();

    // 目录在前、同类按名称排序，保证树结构展示稳定
    results.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(results)
}

pub fn list_directory(path_str: &str, workspace_root: &Path) -> Result<Vec<String>, String> {
    let target = if path_str.is_empty() || path_str == "." {
        workspace_root.to_path_buf()
    } else {
        resolve_in_workspace(path_str, workspace_root)?
    };

    if !is_path_inside_workspace(&target, workspace_root) {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }

    let entries = fs::read_dir(&target).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut results = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            results.push(format!("{}/", name));
        } else {
            results.push(name);
        }
    }

    results.sort();
    Ok(results)
}
