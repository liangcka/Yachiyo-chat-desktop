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

/// 文件工具不得读取或改写用于恢复的私有元数据，也不接受带父级跳转的路径。
pub fn resolve_tool_path(path_str: &str, workspace_root: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    let target = resolve_in_workspace(path_str, workspace_root)?;
    let lexical = Path::new(path_str);
    let relative = if lexical.is_relative() { Some(lexical) } else { target.strip_prefix(workspace_root).ok() };
    if relative.map(is_checkpoint_path).unwrap_or(false) {
        return Err("Access denied: 检查点存储仅允许通过恢复接口访问".to_string());
    }
    if target.components().any(|part| matches!(part, Component::ParentDir))
        || !is_path_inside_workspace(&target, workspace_root)
    {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }
    let root = workspace_root.canonicalize().map_err(|e| e.to_string())?;
    let mut ancestor = target.as_path();
    let mut missing = Vec::new();
    while fs::symlink_metadata(ancestor).is_err() {
        missing.push(ancestor.file_name().ok_or("无效文件路径")?.to_os_string());
        ancestor = ancestor.parent().ok_or("无效文件路径")?;
    }
    let mut canonical = ancestor.canonicalize().map_err(|e| e.to_string())?;
    for part in missing.into_iter().rev() {
        canonical.push(part);
    }
    let relative = canonical.strip_prefix(&root).map_err(|_| "文件路径越界")?;
    if is_checkpoint_path(relative) || crate::gateway::agent::checkpoint::is_private_storage_path(&canonical) {
        return Err("Access denied: 检查点存储仅允许通过恢复接口访问".to_string());
    }
    Ok(canonical)
}

fn is_checkpoint_path(relative: &Path) -> bool {
    let mut components = relative.components().filter_map(|part| match part {
        std::path::Component::Normal(name) => Some(name.to_string_lossy().to_lowercase()),
        _ => None,
    });
    components.next().as_deref() == Some(".yachiyo")
        && components.next().as_deref() == Some("checkpoints")
}

/// 未绑定项目的读取仅接受显式绝对路径，且不放开检查点私有存储。
pub fn resolve_unbound_read_path(path_str: &str) -> Result<PathBuf, String> {
    let path = Path::new(path_str);
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("当前未打开项目工作区，请使用用户提供的绝对路径读取文件或目录。".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| format!("无法读取路径 '{}': {}", path_str, error))?;
    let contains_checkpoint = |target: &Path| target.ancestors().any(|ancestor| {
        ancestor.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("checkpoints"))
            && ancestor.parent().and_then(Path::file_name)
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(".yachiyo"))
    });
    if contains_checkpoint(path) || contains_checkpoint(&canonical)
        || crate::gateway::agent::checkpoint::is_private_storage_path(&canonical)
    {
        return Err("Access denied: 检查点存储仅允许通过恢复接口访问".to_string());
    }
    Ok(canonical)
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
    let resolved = resolve_tool_path(path_str, workspace_root)?;

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
    let resolved = resolve_tool_path(path_str, workspace_root)?;

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

    // 替换目录项，避免硬链接把写入传播到工作区外的同一文件。
    let temporary = resolved.with_file_name(format!(".yachiyo-write-{:016x}", rand::random::<u64>()));
    use std::io::Write;
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)
        .map_err(|e| format!("Failed to write file '{}': {}", path_str, e))?;
    let result = output.write_all(content.as_bytes()).and_then(|_| {
        if exists { fs::set_permissions(&temporary, fs::metadata(&resolved)?.permissions())?; }
        Ok(())
    });
    drop(output);
    if let Err(error) = result.and_then(|_| fs::rename(&temporary, &resolved)) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Failed to write file '{}': {}", path_str, error));
    }

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

/// 默认排除的大型开发与依赖目录，避免深度递归卡顿
const SEARCH_IGNORE_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".yachiyo",
    ".vscode",
    ".idea",
    ".gemini",
    "coverage",
    ".next",
    ".nuxt",
];

/// 模糊匹配评分：返回匹配成功时的分数，None 表示不匹配
fn score_fuzzy_match(path_lower: &str, query_lower: &str, file_name_lower: &str) -> Option<i32> {
    if query_lower.is_empty() {
        return Some(0);
    }

    // 1. 完全包含在文件名中（最高优先级）
    if let Some(pos) = file_name_lower.find(query_lower) {
        let score = 1000 - (pos as i32 * 10) - (file_name_lower.len() as i32);
        return Some(score);
    }

    // 2. 完全包含在整段相对路径中
    if let Some(pos) = path_lower.find(query_lower) {
        let score = 500 - (pos as i32 * 5) - (path_lower.len() as i32);
        return Some(score);
    }

    // 3. 子序列匹配（字符按先后顺序出现）
    let mut q_chars = query_lower.chars().peekable();
    let mut last_idx = 0;
    let mut distance_penalty = 0;
    let mut matched_count = 0;

    for (i, c) in path_lower.char_indices() {
        if let Some(&qc) = q_chars.peek() {
            if c == qc {
                q_chars.next();
                if matched_count > 0 {
                    distance_penalty += (i - last_idx).saturating_sub(1) as i32;
                }
                last_idx = i;
                matched_count += 1;
            }
        }
    }

    if q_chars.peek().is_none() {
        let score = 200 - distance_penalty * 2 - (path_lower.len() as i32);
        Some(score)
    } else {
        None
    }
}

/// 快速检索工作区中的文件（用于 @ 引用智能补全与模糊搜索）
pub fn search_workspace_files(
    query: Option<&str>,
    limit: Option<usize>,
    workspace_root: &Path,
) -> Result<Vec<String>, String> {
    let max_results = limit.unwrap_or(20).clamp(1, 100);
    let query_trimmed = query.map(|q| q.trim()).unwrap_or("");
    let query_lower = query_trimmed.to_lowercase();

    let mut stack = vec![workspace_root.to_path_buf()];
    let mut scanned_files = 0;
    const MAX_SCAN_FILES: usize = 6000;

    let mut candidates: Vec<(String, i32)> = Vec::new();

    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };

            let name = entry.file_name().to_string_lossy().to_string();

            if file_type.is_dir() {
                if !SEARCH_IGNORE_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                    stack.push(entry.path());
                }
            } else if file_type.is_file() {
                scanned_files += 1;
                if scanned_files > MAX_SCAN_FILES {
                    break;
                }

                let full_path = entry.path();
                let rel_path = match full_path.strip_prefix(workspace_root) {
                    Ok(p) => p.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };

                let path_lower = rel_path.to_lowercase();
                let name_lower = name.to_lowercase();

                if let Some(score) = score_fuzzy_match(&path_lower, &query_lower, &name_lower) {
                    candidates.push((rel_path, score));
                }
            }
        }

        if scanned_files > MAX_SCAN_FILES {
            break;
        }
    }

    // 分数降序排列；分数相同则按路径升序
    candidates.sort_by(|a, b| match b.1.cmp(&a.1) {
        std::cmp::Ordering::Equal => a.0.cmp(&b.0),
        other => other,
    });

    let results = candidates
        .into_iter()
        .take(max_results)
        .map(|(path, _)| path)
        .collect();

    Ok(results)
}

