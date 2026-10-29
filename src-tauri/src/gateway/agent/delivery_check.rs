//! 交付前的执行反馈：按“取证 → 修改 → 验证 → 处理失败 → 交付”的顺序检查运行的执行记录。
//! 模型准备结束时，若修改过代码却没有在之后运行验证，或最近一次验证失败，提醒一次并让循环继续；
//! 每种提醒在一次运行中最多一次，模型仍可在总结里说明不验证的理由。
use crate::tools::process::CommandOutcome;
use crate::types::ToolInvocation;
use std::sync::OnceLock;

/// 构建、测试、类型检查与静态检查类命令；与前端 `domain/verification.ts` 的判定保持一致
fn verification_pattern() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(concat!(
            r"(?i)(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?(?:test|lint|typecheck|check|build|verify|e2e)\b",
            r"|(?:^|[\s;&|(])(?:vitest|jest|mocha|pytest|tox|tsc|eslint|ruff|mypy|flake8|playwright)\b",
            r"|(?:^|[\s;&|(])cargo\s+(?:test|check|clippy|build|nextest)\b",
            r"|(?:^|[\s;&|(])go\s+(?:test|vet|build)\b",
            r"|(?:^|[\s;&|(])(?:mvn|gradle|gradlew|\./gradlew)\b.*\b(?:test|check|build|verify)\b",
            r"|(?:^|[\s;&|(])(?:dotnet)\s+(?:test|build)\b",
            r"|(?:^|[\s;&|(])make\s+(?:test|check|lint|build)\b",
            r"|(?:^|[\s;&|(])python3?\s+-m\s+(?:pytest|unittest|mypy)\b",
            // 在命令开头执行的项目测试或检查脚本（sh test.sh、./scripts/run-tests.sh、pwsh -File check.ps1）；cat test.sh 之类的读取不算
            r"|(?:^|[;&|(]\s*)(?:(?:sh|bash|zsh|pwsh|powershell(?:\.exe)?)\s+(?:-\S+\s+)*)?(?:\.{0,2}[\\/])?(?:[\w.-]+[\\/])*[\w.-]*(?:test|tests|check|lint|verify)[\w.-]*\.(?:sh|bash|ps1|bat|cmd)\b",
        ))
        .expect("验证命令正则有效")
    })
}

pub fn is_verification_command(command: &str) -> bool {
    verification_pattern().is_match(command)
}

/// 只有源代码改动才需要验证；文档、配置说明等不提醒
fn is_code_path(path: &str) -> bool {
    const CODE_EXTENSIONS: &[&str] = &[
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "rs", "py", "go", "java", "kt", "kts", "scala", "c", "h", "cc", "cpp",
        "hpp", "cs", "rb", "php", "swift", "m", "mm", "dart", "lua", "css", "scss", "less", "sql",
    ];
    path.rsplit_once('.').is_some_and(|(_, extension)| CODE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryReminder {
    /// 修改了代码，之后没有运行验证
    NotVerified { files: Vec<String> },
    /// 最近一次验证没有通过
    VerificationFailed { command: String },
}

#[derive(Debug, Default)]
pub struct DeliveryCheck {
    modified_since_verification: Vec<String>,
    last_verification: Option<(String, bool)>,
    reminded_unverified: bool,
    reminded_failed: bool,
}

impl DeliveryCheck {
    /// 登记一个工具结果
    pub fn observe(&mut self, call: &ToolInvocation, is_error: bool, command: Option<&CommandOutcome>) {
        match call.name.as_str() {
            "write_file" | "edit_file" if !is_error => {
                if let Some(path) = call.arguments.get("path").and_then(|value| value.as_str()) {
                    let path = path.replace('\\', "/");
                    if is_code_path(&path) && !self.modified_since_verification.contains(&path) {
                        self.modified_since_verification.push(path);
                    }
                }
            }
            "run_command" => {
                let Some(text) = call.arguments.get("command").and_then(|value| value.as_str()) else { return };
                if !is_verification_command(text) {
                    return;
                }
                // 被停止或无法确认退出的验证不算结论，也不清空之前的修改
                let Some(outcome) = command else { return };
                if outcome.end_reason == crate::tools::process::CommandEndReason::Cancelled || !outcome.exit_confirmed {
                    return;
                }
                let passed = outcome.succeeded();
                self.last_verification = Some((text.trim().to_string(), passed));
                self.modified_since_verification.clear();
                if passed {
                    self.reminded_failed = false;
                }
            }
            _ => {}
        }
    }

    /// 模型准备结束时调用：需要提醒时返回提醒并记为已提醒
    pub fn before_finish(&mut self) -> Option<DeliveryReminder> {
        if !self.modified_since_verification.is_empty() && !self.reminded_unverified {
            self.reminded_unverified = true;
            return Some(DeliveryReminder::NotVerified { files: self.modified_since_verification.clone() });
        }
        if let Some((command, false)) = &self.last_verification {
            if !self.reminded_failed {
                self.reminded_failed = true;
                return Some(DeliveryReminder::VerificationFailed { command: command.clone() });
            }
        }
        None
    }
}

impl DeliveryReminder {
    pub fn message(&self, japanese: bool) -> String {
        match (self, japanese) {
            (Self::NotVerified { files }, false) => format!(
                "[执行反馈] 你修改了以下代码文件，但之后没有运行验证：{}。交付前请运行相关的测试、构建或类型检查并根据结果处理；确实无法验证时，在总结中说明原因与风险。",
                files.join("、")
            ),
            (Self::NotVerified { files }, true) => format!(
                "[実行フィードバック] 次のコードファイルを変更しましたが、その後に検証を実行していません：{}。完了前に関連するテスト・ビルド・型チェックを実行し、結果に応じて対応してください。検証できない場合は、理由とリスクをまとめに書いてください。",
                files.join("、")
            ),
            (Self::VerificationFailed { command }, false) => format!(
                "[执行反馈] 最近一次验证没有通过：`{command}`。请先分析失败原因并修复后重新验证；无法修复时，在总结中如实说明失败与剩余问题，不要声称已通过。"
            ),
            (Self::VerificationFailed { command }, true) => format!(
                "[実行フィードバック] 直近の検証が通っていません：`{command}`。失敗の原因を調べて修正し、再度検証してください。修正できない場合は、失敗と残っている問題をまとめに正直に書き、通ったとは書かないでください。"
            ),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::NotVerified { .. } => "not_verified",
            Self::VerificationFailed { .. } => "verification_failed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_verification_command;

    #[test]
    fn project_test_scripts_count_only_when_executed() {
        for command in ["sh test.sh", "./scripts/run-tests.sh --fast", "cd app && bash scripts/check.sh", "pwsh -NoProfile -File .\\scripts\\lint.ps1", "cargo test", "npm run lint"] {
            assert!(is_verification_command(command), "{command}");
        }
        for command in ["cat test.sh", "vim scripts/lint.sh", "git status", "ls tests", "cat test.log"] {
            assert!(!is_verification_command(command), "{command}");
        }
    }
}
