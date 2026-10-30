use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalChoice {
    Once,
    Always,
    Deny,
}

#[derive(Debug, Clone, Copy)]
pub struct ApprovalDecision {
    pub approved: bool,
    /// true 时持久记住工作区与参数范围；写入失败时仅批准本次调用。
    pub session_scope: bool,
}

/// 全局批准注册表：SSE 流内发起 permission_request，POST /api/agent/approval 回填决定
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
    allowed: Mutex<HashSet<String>>,
    storage_path: Option<PathBuf>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredApprovals {
    version: u32,
    scopes: HashSet<String>,
}

fn scope_digest(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}

fn reject_link(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                metadata.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let linked = metadata.file_type().is_symlink();
            if linked {
                Err("授权配置不得为符号链接".to_string())
            } else {
                Ok(())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_storage(path: PathBuf) -> Self {
        let allowed = (|| -> Result<HashSet<String>, String> {
            let parent = path.parent().ok_or("授权存储路径无效")?;
            reject_link(parent)?;
            reject_link(&path)?;
            if !path.exists() {
                return Ok(HashSet::new());
            }
            if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
                return Err("授权配置过大".to_string());
            }
            let data: StoredApprovals =
                serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if data.version != 1
                || data.scopes.len() > 65_536
                || data.scopes.iter().any(|scope| {
                    scope.len() != 64 || !scope.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
            {
                return Err("授权配置格式无效".to_string());
            }
            Ok(data.scopes)
        })()
        .unwrap_or_else(|error| {
            tracing::warn!("读取持久授权失败，改为逐次确认: {}", error);
            HashSet::new()
        });
        Self {
            allowed: Mutex::new(allowed),
            storage_path: Some(path),
            ..Self::default()
        }
    }

    pub fn register(&self, request_id: &str) -> oneshot::Receiver<ApprovalDecision> {
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap()
            .insert(request_id.to_string(), tx);
        rx
    }

    /// 送达决定；返回 false 表示 requestId 未知或已被消费（超时/取消）
    pub fn resolve(&self, request_id: &str, decision: ApprovalDecision) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn cancel(&self, request_id: &str) {
        self.pending.lock().unwrap().remove(request_id);
    }

    pub fn is_allowed(&self, key: &str) -> bool {
        self.allowed.lock().unwrap().contains(&scope_digest(key))
    }

    pub fn remember(&self, key: String) -> Result<(), String> {
        let mut allowed = self.allowed.lock().unwrap();
        let mut scopes = allowed.clone();
        scopes.insert(scope_digest(&key));
        if scopes.len() > 65_536 {
            return Err("长期授权数量超过限制".to_string());
        }
        if let Some(path) = &self.storage_path {
            let parent = path.parent().ok_or("授权存储路径无效")?;
            reject_link(parent)?;
            reject_link(path)?;
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            let temporary = parent.join(format!(
                "agent-approvals-{:016x}.tmp",
                rand::random::<u64>()
            ));
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            let result = (|| {
                file.write_all(
                    &serde_json::to_vec(&StoredApprovals {
                        version: 1,
                        scopes: scopes.clone(),
                    })
                    .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())
            })();
            drop(file);
            if let Err(error) =
                result.and_then(|_| std::fs::rename(&temporary, path).map_err(|e| e.to_string()))
            {
                let _ = std::fs::remove_file(temporary);
                return Err(error);
            }
        }
        *allowed = scopes;
        Ok(())
    }
}

/// shell 只记忆完整命令；前缀或首个词元无法约束重定向、拼接和参数中的副作用。
pub fn approval_key(
    name: &str,
    args: &serde_json::Value,
    workspace: Option<&Path>,
) -> Result<String, String> {
    let root = crate::tools::working_root(workspace)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let category = match name {
        "run_command" => format!(
            "command:{}",
            args.get("command")
                .and_then(|v| v.as_str())
                .ok_or("缺少命令")?
                .trim()
        ),
        "write_file" | "edit_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少文件路径")?;
            // 无项目写入的根随目标而定，批准范围必须与执行时解析出的目标一致
            let write_root = crate::tools::file_write_root(path, workspace)?;
            let target = crate::tools::fs::resolve_tool_path(path, &write_root)?;
            format!("file:{}", target.to_string_lossy())
        }
        "read_file" if workspace.is_none() => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少文件路径")?;
            let target = crate::tools::fs::resolve_unbound_read_path(path)?;
            let parent = target.parent().unwrap_or(&target);
            format!("directory:{}", parent.to_string_lossy())
        }
        "list_directory" if workspace.is_none() => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少目录路径")?;
            let target = crate::tools::fs::resolve_unbound_read_path(path)?;
            format!("directory:{}", target.to_string_lossy())
        }
        _ => format!("tool:{}:{}", name, args),
    };
    Ok(format!("{}\n{}", root.to_string_lossy(), category))
}
