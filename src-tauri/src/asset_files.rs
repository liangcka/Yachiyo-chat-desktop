//! 拖入的文件与消息里的本地视频经 asset 协议交给 webview 读取。
//! 配置里的 scope 为空，只在运行时逐个放行具体文件，目录与相对路径一律不放行。

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// 只接受存在的绝对路径普通文件；返回原样路径，asset scope 与 `convertFileSrc` 都按它匹配
pub fn inspect_asset_file(raw: &str) -> Option<AssetFile> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return None;
    }
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().to_string();
    Some(AssetFile { path: raw.to_string(), name, size: metadata.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_absolute_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("片段.mp4");
        std::fs::write(&file, b"1234").unwrap();
        let raw = file.to_string_lossy().to_string();
        assert_eq!(
            inspect_asset_file(&raw),
            Some(AssetFile { path: raw.clone(), name: "片段.mp4".into(), size: 4 })
        );
    }

    #[test]
    fn rejects_directory_relative_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(inspect_asset_file(&dir.path().to_string_lossy()), None);
        assert_eq!(inspect_asset_file("Cargo.toml"), None);
        assert_eq!(inspect_asset_file(&dir.path().join("missing.mp4").to_string_lossy()), None);
    }
}
