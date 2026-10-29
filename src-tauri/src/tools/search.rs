use regex::{Regex, RegexBuilder};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::fs::{resolve_tool_path, SEARCH_IGNORE_DIRS};

const MAX_SCAN_FILES: usize = 20_000;
const GLOB_RESULT_LIMIT: usize = 200;
const GREP_DEFAULT_HEAD_LIMIT: usize = 250;
const GREP_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub const PROJECT_REQUIRED_FOR_SEARCH: &str = "当前任务未绑定项目，无法检索工作区。请让用户在输入框上方为本任务绑定项目，或用 read_file / list_directory 读取用户给出的绝对路径。";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrepOutputMode {
    Content,
    FilesWithMatches,
    Count,
}

impl GrepOutputMode {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("files_with_matches") {
            "content" => Ok(Self::Content),
            "files_with_matches" => Ok(Self::FilesWithMatches),
            "count" => Ok(Self::Count),
            other => Err(format!("output_mode 无效：'{other}'，可选 content / files_with_matches / count")),
        }
    }
}

pub struct GrepOptions<'a> {
    pub pattern: &'a str,
    pub path: Option<&'a str>,
    pub glob: Option<&'a str>,
    pub output_mode: GrepOutputMode,
    pub case_insensitive: bool,
    pub context: usize,
    pub head_limit: Option<usize>,
}

/// 把 glob 模式翻译为锚定正则；支持 `**`、`*`、`?`、`[...]` 与 `{a,b}`。
/// 不含 `/` 的模式匹配任意层级的文件名，与常见编辑器/CLI 的直觉一致。
pub fn glob_to_regex(pattern: &str) -> Result<Regex, String> {
    let normalized = pattern.trim().replace('\\', "/");
    let normalized = normalized.trim_start_matches("./");
    if normalized.is_empty() {
        return Err("glob 模式不能为空".to_string());
    }
    let body = if normalized.contains('/') { normalized.to_string() } else { format!("**/{normalized}") };
    let chars: Vec<char> = body.chars().collect();
    let mut out = String::from("^");
    let mut brace_depth = 0usize;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' if chars.get(i + 1) == Some(&'*') => {
                let at_segment_start = i == 0 || chars[i - 1] == '/';
                if at_segment_start && chars.get(i + 2) == Some(&'/') {
                    out.push_str("(?:[^/]*/)*");
                    i += 3;
                    continue;
                }
                out.push_str(".*");
                i += 2;
                continue;
            }
            '*' => out.push_str("[^/]*"),
            '?' => out.push_str("[^/]"),
            '[' => {
                let close = chars[i + 1..].iter().position(|&ch| ch == ']').map(|p| p + i + 1);
                match close {
                    Some(end) if end > i + 1 => {
                        let inner: String = chars[i + 1..end].iter().collect();
                        let inner = inner.strip_prefix('!').map(|rest| format!("^{rest}")).unwrap_or(inner);
                        out.push('[');
                        out.push_str(&inner.replace('\\', "\\\\"));
                        out.push(']');
                        i = end + 1;
                        continue;
                    }
                    _ => out.push_str("\\["),
                }
            }
            '{' => {
                brace_depth += 1;
                out.push_str("(?:");
            }
            '}' if brace_depth > 0 => {
                brace_depth -= 1;
                out.push(')');
            }
            ',' if brace_depth > 0 => out.push('|'),
            other => out.push_str(&regex::escape(&other.to_string())),
        }
        i += 1;
    }
    if brace_depth > 0 {
        return Err(format!("glob 模式括号不匹配：'{pattern}'"));
    }
    out.push('$');
    Regex::new(&out).map_err(|e| format!("glob 模式无效：{e}"))
}

fn resolve_search_root(path: Option<&str>, workspace_root: &Path) -> Result<PathBuf, String> {
    match path.map(str::trim).filter(|p| !p.is_empty() && *p != ".") {
        Some(p) => resolve_tool_path(p, workspace_root),
        None => workspace_root.canonicalize().map_err(|e| e.to_string()),
    }
}

/// 深度优先遍历工作区文件，跳过依赖、构建产物与私有存储目录；回调返回 false 时提前停止。
fn walk_files(root: &Path, mut visit: impl FnMut(&Path) -> bool) -> bool {
    if root.is_file() {
        visit(root);
        return false;
    }
    let mut stack = vec![root.to_path_buf()];
    let mut scanned = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        let mut children: Vec<_> = entries.flatten().collect();
        children.sort_by_key(|entry| entry.file_name());
        for entry in children.into_iter().rev() {
            let Ok(file_type) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            if file_type.is_dir() {
                if !SEARCH_IGNORE_DIRS.contains(&name.as_str()) {
                    stack.push(entry.path());
                }
            } else if file_type.is_file() {
                scanned += 1;
                if scanned > MAX_SCAN_FILES {
                    return true;
                }
                if !visit(&entry.path()) {
                    return false;
                }
            }
        }
    }
    false
}

fn relative_display(path: &Path, workspace_root: &Path) -> String {
    let root = workspace_root.canonicalize().unwrap_or_else(|_| workspace_root.to_path_buf());
    path.strip_prefix(&root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn relative_to(path: &Path, base: &Path) -> String {
    path.strip_prefix(base).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

/// 按 glob 模式查找文件，结果按修改时间倒序，便于优先看到最近改动的文件。
pub fn glob_files(pattern: &str, path: Option<&str>, workspace_root: &Path) -> Result<String, String> {
    let matcher = glob_to_regex(pattern)?;
    let base = resolve_search_root(path, workspace_root)?;
    let mut hits: Vec<(SystemTime, String)> = Vec::new();
    let truncated_scan = walk_files(&base, |file| {
        if matcher.is_match(&relative_to(file, &base)) {
            let mtime = fs::metadata(file).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            hits.push((mtime, relative_display(file, workspace_root)));
        }
        true
    });
    if hits.is_empty() {
        return Ok(format!("没有匹配 '{pattern}' 的文件。"));
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let total = hits.len();
    let mut lines: Vec<String> = hits.into_iter().take(GLOB_RESULT_LIMIT).map(|(_, p)| p).collect();
    if total > GLOB_RESULT_LIMIT {
        lines.push(format!("[共 {total} 个匹配，仅显示前 {GLOB_RESULT_LIMIT} 个，请收窄模式或指定 path]"));
    }
    if truncated_scan {
        lines.push(format!("[扫描超过 {MAX_SCAN_FILES} 个文件后停止，结果可能不完整]"));
    }
    Ok(lines.join("\n"))
}

fn read_text_file(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > GREP_MAX_FILE_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    fs::File::open(path).ok()?.read_to_end(&mut bytes).ok()?;
    if bytes.iter().take(8 * 1024).any(|&b| b == 0) {
        return None;
    }
    Some(super::fs::decode_file_bytes(&bytes))
}

/// 在工作区内按正则检索文件内容，输出形态对齐 ripgrep 的三种模式。
pub fn grep_files(options: &GrepOptions<'_>, workspace_root: &Path) -> Result<String, String> {
    if options.pattern.is_empty() {
        return Err("pattern 不能为空".to_string());
    }
    let regex = RegexBuilder::new(options.pattern)
        .case_insensitive(options.case_insensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| format!("正则表达式无效：{e}"))?;
    let file_filter = options.glob.map(glob_to_regex).transpose()?;
    let base = resolve_search_root(options.path, workspace_root)?;
    let head_limit = options.head_limit.filter(|n| *n > 0).unwrap_or(GREP_DEFAULT_HEAD_LIMIT);
    let context = options.context.min(10);

    let mut lines: Vec<String> = Vec::new();
    let mut total_matches = 0usize;
    let mut limited = false;
    let truncated_scan = walk_files(&base, |file| {
        if let Some(filter) = &file_filter {
            if !filter.is_match(&relative_to(file, &base)) {
                return true;
            }
        }
        let Some(text) = read_text_file(file) else { return true };
        let display = relative_display(file, workspace_root);
        match options.output_mode {
            GrepOutputMode::FilesWithMatches => {
                if regex.is_match(&text) {
                    lines.push(display);
                }
            }
            GrepOutputMode::Count => {
                let count = text.lines().filter(|line| regex.is_match(line)).count();
                if count > 0 {
                    total_matches += count;
                    lines.push(format!("{display}:{count}"));
                }
            }
            GrepOutputMode::Content => {
                let file_lines: Vec<&str> = text.lines().collect();
                let mut last_emitted: Option<usize> = None;
                for (idx, line) in file_lines.iter().enumerate() {
                    if !regex.is_match(line) {
                        continue;
                    }
                    total_matches += 1;
                    let start = idx.saturating_sub(context);
                    let end = (idx + context).min(file_lines.len().saturating_sub(1));
                    let from = match last_emitted {
                        Some(prev) if prev + 1 >= start => prev + 1,
                        Some(_) => {
                            lines.push("--".to_string());
                            start
                        }
                        None => start,
                    };
                    for n in from..=end {
                        let sep = if n == idx || regex.is_match(file_lines[n]) { ':' } else { '-' };
                        lines.push(format!("{display}{sep}{}{sep}{}", n + 1, file_lines[n]));
                    }
                    last_emitted = Some(end);
                }
            }
        }
        if lines.len() >= head_limit {
            limited = true;
            return false;
        }
        true
    });

    if lines.is_empty() {
        return Ok(format!("没有匹配 '{}' 的内容。", options.pattern));
    }
    lines.truncate(head_limit);
    if options.output_mode == GrepOutputMode::Count {
        lines.push(format!("[合计 {total_matches} 处匹配]"));
    }
    if limited {
        lines.push(format!("[结果已达 head_limit={head_limit}，可能还有更多匹配，请收窄 pattern、glob 或 path]"));
    }
    if truncated_scan {
        lines.push(format!("[扫描超过 {MAX_SCAN_FILES} 个文件后停止，结果可能不完整]"));
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src/components")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".yachiyo/checkpoints")).unwrap();
        fs::write(root.join("src/main.ts"), "import { app } from './app';\napp.start();\n").unwrap();
        fs::write(root.join("src/components/Button.tsx"), "export function Button() {\n  return null;\n}\n").unwrap();
        fs::write(root.join("README.md"), "# Demo\nTODO: write docs\n").unwrap();
        fs::write(root.join("node_modules/pkg/index.ts"), "export function Button() {}\n").unwrap();
        fs::write(root.join(".yachiyo/checkpoints/secret.ts"), "export function Button() {}\n").unwrap();
        fs::write(root.join("src/blob.bin"), [0u8, 1, 2, b'B', b'u']).unwrap();
        dir
    }

    #[test]
    fn glob_translation_covers_common_forms() {
        assert!(glob_to_regex("*.ts").unwrap().is_match("src/main.ts"));
        assert!(glob_to_regex("src/**/*.tsx").unwrap().is_match("src/components/Button.tsx"));
        assert!(glob_to_regex("src/**/*.tsx").unwrap().is_match("src/Button.tsx"));
        assert!(!glob_to_regex("src/*.tsx").unwrap().is_match("src/components/Button.tsx"));
        assert!(glob_to_regex("*.{ts,tsx}").unwrap().is_match("a/b.tsx"));
        assert!(glob_to_regex("file?.[jt]s").unwrap().is_match("file1.ts"));
        assert!(!glob_to_regex("file[!0-9].ts").unwrap().is_match("file1.ts"));
        assert!(glob_to_regex("{a,b").is_err());
    }

    #[test]
    fn glob_skips_dependency_and_private_dirs() {
        let dir = fixture();
        let out = glob_files("**/*.ts", None, dir.path()).unwrap();
        assert_eq!(out, "src/main.ts");
        let tsx = glob_files("*.tsx", Some("src"), dir.path()).unwrap();
        assert_eq!(tsx, "src/components/Button.tsx");
    }

    #[test]
    fn glob_rejects_paths_outside_workspace() {
        let dir = fixture();
        assert!(glob_files("*", Some("../"), dir.path()).is_err());
        assert!(glob_files("*", Some(".yachiyo/checkpoints"), dir.path()).is_err());
    }

    #[test]
    fn grep_modes_match_ripgrep_shapes() {
        let dir = fixture();
        let base = |mode| GrepOptions {
            pattern: "button",
            path: None,
            glob: None,
            output_mode: mode,
            case_insensitive: true,
            context: 0,
            head_limit: None,
        };
        assert_eq!(grep_files(&base(GrepOutputMode::FilesWithMatches), dir.path()).unwrap(), "src/components/Button.tsx");
        assert_eq!(
            grep_files(&base(GrepOutputMode::Content), dir.path()).unwrap(),
            "src/components/Button.tsx:1:export function Button() {"
        );
        assert_eq!(
            grep_files(&base(GrepOutputMode::Count), dir.path()).unwrap(),
            "src/components/Button.tsx:1\n[合计 1 处匹配]"
        );
    }

    #[test]
    fn grep_supports_context_glob_and_head_limit() {
        let dir = fixture();
        let options = GrepOptions {
            pattern: "app",
            path: Some("src"),
            glob: Some("*.ts"),
            output_mode: GrepOutputMode::Content,
            case_insensitive: false,
            context: 1,
            head_limit: Some(1),
        };
        let out = grep_files(&options, dir.path()).unwrap();
        assert!(out.starts_with("src/main.ts:1:import { app }"));
        assert!(out.contains("head_limit=1"));
        assert!(grep_files(&GrepOptions { pattern: "(", ..options }, dir.path()).is_err());
    }
}
