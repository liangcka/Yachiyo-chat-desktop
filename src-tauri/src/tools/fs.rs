use std::fs;
use std::path::{Path, PathBuf};

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

pub fn read_file(path_str: &str, workspace_root: &Path) -> Result<String, String> {
    let target = PathBuf::from(path_str);
    let resolved = if target.is_relative() {
        workspace_root.join(target)
    } else {
        target
    };

    if !is_path_inside_workspace(&resolved, workspace_root) {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }

    fs::read_to_string(&resolved).map_err(|e| format!("Failed to read file '{}': {}", path_str, e))
}

pub fn write_file(path_str: &str, content: &str, workspace_root: &Path) -> Result<String, String> {
    let target = PathBuf::from(path_str);
    let resolved = if target.is_relative() {
        workspace_root.join(target)
    } else {
        target
    };

    if !is_path_inside_workspace(&resolved, workspace_root) {
        return Err(format!("Access denied: Path '{}' is outside workspace boundary", path_str));
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    fs::write(&resolved, content)
        .map(|_| format!("Successfully wrote {} bytes to '{}'", content.len(), path_str))
        .map_err(|e| format!("Failed to write file '{}': {}", path_str, e))
}

pub fn list_directory(path_str: &str, workspace_root: &Path) -> Result<Vec<String>, String> {
    let target = if path_str.is_empty() || path_str == "." {
        workspace_root.to_path_buf()
    } else {
        let p = PathBuf::from(path_str);
        if p.is_relative() {
            workspace_root.join(p)
        } else {
            p
        }
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
