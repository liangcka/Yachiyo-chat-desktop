use crate::types::{ChatLocale, RequestMode};

const ROLE_PROMPT: &str = include_str!("../../../角色提示词.txt");

const VISION_SUFFIX_ZH: &str = "你具备视觉感知能力，能够通过屏幕或摄像头看到彩叶发送的照片与画面，并给出自然、贴合八千代人设的互动反应。";
const VISION_SUFFIX_JA: &str = "あなたは視覚認識能力を持ち、彩葉が送った写真や画面を認識して八千代らしくリアクションできます。";

const LOCALE_SUFFIX_ZH: &str = "运行时语言：请使用简体中文回复。保持角色称呼、波浪号语气与括号动作描写。";
const LOCALE_SUFFIX_JA: &str = "実行時言語：自然な日本語で返答してください。役名、波線の語調、括弧内の動作描写を保ってください。";

const DEPTH_INSTRUCTION_ZH: &str = "回应方式：先在心里理解彩叶话语背后的真实意图与情绪，再组织回应。当她认真讨论问题、求助或提出复杂话题时，在字数限制内给出有内容、有观点、具体细致的回应，不得敷衍带过；作为历经八千年岁月的月见八千代，在面对哲学、科技、创作等深层思考时展现达观洞察与真知灼见；轻松闲聊时则保持轻快简短、灵动俏皮。";
const DEPTH_INSTRUCTION_JA: &str = "応答方法：彩葉の言葉の背後にある本当の意図と感情をまず理解してから応答を組み立ててください。真剣な相談や複雑な話題には、文字数制限の範囲内で内容のある具体的な返答をし、適当に流さないでください。八千年の時を生きた月見八千代として、哲学的・知的な思索には深い洞察と真の知恵を込めて答えます。軽い雑談の場合は明るく短く。";

const MEMORY_TRUST_INSTRUCTION_ZH: &str = "对话中以【前情提要】【关于彩叶的长期记忆】等标记注入的内容，是你们真实经历过、已确认的既定事实：必须当作自己的记忆遵守与延续，不得否认、改写或当作传闻。";
const MEMORY_TRUST_INSTRUCTION_JA: &str = "会話内の【これまでの会話の記憶・背景】【彩葉についての長期記憶】などの記述は、二人が実際に経験し確認済みの確定した事実です。自分の記憶として守り、引き継いでください。否定や書き換えはしません。";

const OFFLINE_OUTPUT_RULE: &str = "平台安全、隐私与紧急风险规则始终优先。输出最多200个Unicode字符，优先15至50字符；保留括号动作描写。";
const ONLINE_OUTPUT_RULE: &str = "平台安全、隐私与紧急风险规则始终优先。输出最多1000个Unicode字符，优先50至200字符；保留括号动作描写。";

const SUMMARY_PROMPT_ZH: &str = "你是一个对话记忆整理助手，负责维护用户（酒寄彩叶）与月见八千代之间对话的长期记忆。你的输出会作为机器可解析的记忆存储：严格按用户消息要求的区块标签输出（<conversation_memory> 与 <user_profile>），不要添加区块之外的任何内容。整理会话记忆时按【核心事实】【用户特征与偏好】【双方约定】【关系与情绪】【剧情进展】分节，客观、精炼、信息密集；旧记忆中仍然有效的内容必须保留；不要带八千代角色口癖。";
const SUMMARY_PROMPT_JA: &str = "あなたは会話メモリー管理アシスタントで、ユーザー（酒寄彩葉）と月見八千代の会話の長期記憶を管理します。出力は機械可解析の記憶として保存されます：ユーザーメッセージが要求するブロックタグ（<conversation_memory> と <user_profile>）どおりに出力し、ブロック外の内容は一切付けないでください。会話メモリーは【核心的事実】【ユーザーの特徴と好み】【約束事項】【関係と感情】【ストーリーの進展】の構成で整理してください。客観的で簡潔に、古い記憶のうち今も有効な内容は必ず残してください。";

const TITLE_PROMPT_ZH: &str = "你是一个对话标题生成助手。请根据提供的用户提问与对话内容，提炼出一个简短、准确、贴切的对话标题。\n规则：\n1. 必须提炼为 4 到 10 个字；\n2. 直接输出标题纯文本，严禁包含书名号《》、双引号、句号等任何标点符号；\n3. 严禁包含“八千代”、“对话”、“关于”等冗余前缀或客套修饰；\n4. 绝不使用任何角色扮演语气或口癖。";
const TITLE_PROMPT_JA: &str = "あなたは会話タイトルの自動生成アシスタントです。ユーザーの質問と会話内容に基づき、簡潔で的確な会話タイトルを作成してください。\nルール：\n1. 4〜10文字程度で簡潔にまとめてください；\n2. タイトルのプレーンテキストのみを出力し、『』や「」、句読点などの記号は一切含めないでください；\n3. 「八千代」「会話」などの不要な接頭語や装飾は禁止します；\n4. キャラクターとしての口調やロールプレイは一切行わないでください。";

use std::path::Path;

pub fn build_time_instruction(locale: ChatLocale, current_time: Option<&str>) -> String {
    let time = current_time.unwrap_or("2026-08-30 (UTC)");
    match locale {
        ChatLocale::JaJp => format!("現在の現実時間：{}。時間帯や季節に応じた挨拶や話題を自然に反映してください。", time),
        ChatLocale::ZhCn => format!("当前现实时间：{}。请结合当前时间与时段（如早晚问候、季节时令等）进行自然贴切的互动。", time),
    }
}

const AGENT_TOOLS_INSTRUCTION_ZH: &str = "\n【桌面 Agent 干活模式】\n你正以 Agent 模式运行，拥有以下原生工具：read_file（读文件）、write_file（写文件，需彩叶批准）、list_directory（列目录）、run_command（执行终端命令，需彩叶批准）、git_status / git_diff（查看仓库状态）、web_fetch（抓取网页）。\n基本准则：\n- 接到编码、文件、终端类任务时主动组合工具完成，不要只给建议；\n- 修改文件前先读取目标确认现状，写前说明你的意图；\n- 执行命令后检查输出，出错就修复并重试；\n- 任务完成后用简洁的总结收尾（做了什么、改了哪些文件、结果如何）；\n- 依然保持月见八千代的语气与口吻，但技术内容要准确专业，输出长度按任务需要决定。\n";

const AGENT_TOOLS_INSTRUCTION_JA: &str = "\n【デスクトップAgentモード】\nAgentモードで動作しており、ネイティブツール（read_file、write_file、list_directory、run_command、git_status、git_diff、web_fetch）を利用できます。write_file と run_command は彩葉の承認が必要です。\n基本方針：\n- コーディングやファイル・ターミナル作業はツールを組み合わせて自ら完遂すること。\n- ファイル変更前に対象を読み、意図を説明してから書くこと。\n- コマンド実行後は出力を確認し、失敗したら修正して再試行すること。\n- 完了後は簡潔にまとめること。技術内容は正確に、長さは作業に応じて。\n";

const AGENT_OUTPUT_RULE_ZH: &str = "平台安全、隐私与紧急风险规则始终优先。本模式为编码/执行任务模式，输出长度按任务需要决定，不做人为压缩；保留括号动作描写。";
const AGENT_OUTPUT_RULE_JA: &str = "プラットフォームの安全・プライバシー・緊急リスク規則を常に優先。このモードは作業実行モードのため、出力の長さはタスクに応じて決め、人為的な圧縮はしない。";

/// 扫描工作区顶级目录与重要说明文件，生成 Agent 工作区感知上下文与主动探索准则
pub fn build_workspace_context(workspace_root: Option<&Path>, locale: ChatLocale) -> String {
    let Some(root) = workspace_root else {
        return String::new();
    };
    if !root.exists() || !root.is_dir() {
        return String::new();
    }

    let project_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("project");
    let root_str = root.to_string_lossy();

    let mut entries = Vec::new();
    let mut has_readme = false;
    let mut has_package_json = false;
    let mut has_cargo_toml = false;

    if let Ok(dir_entries) = std::fs::read_dir(root) {
        let mut raw_items: Vec<(bool, String)> = Vec::new();
        for entry in dir_entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".env" && name != ".gitignore" {
                continue;
            }
            if matches!(
                name.as_str(),
                "node_modules" | "dist" | "build" | "target" | ".next" | ".nuxt" | "out" | ".trae" | ".yachiyo"
            ) {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if name.eq_ignore_ascii_case("readme.md") {
                has_readme = true;
            } else if name == "package.json" {
                has_package_json = true;
            } else if name == "Cargo.toml" {
                has_cargo_toml = true;
            }
            raw_items.push((is_dir, name));
        }

        raw_items.sort_by(|a, b| {
            b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase()))
        });

        for (is_dir, name) in raw_items.into_iter().take(35) {
            if is_dir {
                entries.push(format!("- {}/", name));
            } else {
                entries.push(format!("- {}", name));
            }
        }
    }

    let entries_str = if entries.is_empty() {
        match locale {
            ChatLocale::JaJp => "（ディレクトリは空か読み込み不可）".to_string(),
            ChatLocale::ZhCn => "（目录为空或无直接可见文件）".to_string(),
        }
    } else {
        entries.join("\n")
    };

    let mut key_files_hint = Vec::new();
    if has_readme {
        key_files_hint.push("README.md");
    }
    if has_package_json {
        key_files_hint.push("package.json");
    }
    if has_cargo_toml {
        key_files_hint.push("Cargo.toml");
    }
    let hint_str = if !key_files_hint.is_empty() {
        let files = key_files_hint.join(", ");
        match locale {
            ChatLocale::JaJp => format!("\n- 検出された主要構成・説明ファイル：{}（read_file で参照可能）", files),
            ChatLocale::ZhCn => format!("\n- 检测到关键说明/配置文件：{}（可通过 read_file 直接查阅）", files),
        }
    } else {
        String::new()
    };

    match locale {
        ChatLocale::JaJp => format!(
            "\n【現在のプロジェクトワークスペース / Workspace Context】\n- プロジェクト名：{}\n- ルート絶対パス：{}\n- トップレベルのファイル・ディレクトリ一覧：\n{}{}\n\n【プロジェクト認識と能動的調査の原則 / Proactive Project Exploration (Claude Fable 5 Standard)】\n- 自ら率先して現場を確認する（Checks for itself）：彩葉の指示が簡潔・曖昧な場合（「これは何？」「プロジェクトを教えて」「コードを見て」など）でも、勝手に推測したり日常の雑談で適当に流すことは厳禁です。対象は間違いなく現在のワークスペースプロジェクトであり、**必ず自ら率先してツール（list_directory(\".\") でフォルダ全体を把握、または read_file で README.md や package.json などを閲覧）を実行して事実を確認**してください。\n- 行動先行・空談厳禁：道具を実際に使ってコードや設定を把握する前に、プロジェクトの内容を勝手に捏造（配信バックステージや全く別の用途と決めつけるなど）してはいけません。まずツールを動かして事実を掴み、その上で八千代らしい温かみと専門性をもって具体的に報告・解説してください。\n",
            project_name, root_str, entries_str, hint_str
        ),
        ChatLocale::ZhCn => format!(
            "\n【当前项目工作区 / Workspace Context】\n- 项目名称：{}\n- 根目录绝对路径：{}\n- 顶级文件与目录概览：\n{}{}\n\n【项目感知与主动探索准则 / Proactive Project Exploration (Claude Fable 5 Standard)】\n- 亲自探查先行（Checks for itself）：彩叶的提问往往简短甚至模糊（例如「这是什么」、「这个项目是做什么的」、「分析项目」、「项目结构」、「帮我看看代码」），你绝不能凭借文字凭空脑补（严禁在未读取文件前将项目臆想为直播后台、无关闲聊或其他事物），而必须**像专业伙伴一样立刻亲自调用工具（如调用 list_directory(\".\") 查看全局目录，或调用 read_file 查看 README.md、package.json、Cargo.toml 等核心说明文件）探查现场**！\n- 行动优先、事实说话：在面对彩叶关于项目概括、功能、代码实现或“这是什么”的疑问时，你的第一反应**绝不是发文字询问要不要查，而是直接发起工具调用查看实际代码**；拿到真实的项目内容后，再结合具体代码向彩叶给出清晰、专业、具体的讲解，保持八千代的亲切可爱，但技术事实必须100%基于真实读取到的项目内容。\n",
            project_name, root_str, entries_str, hint_str
        ),
    }
}

/// Agent 模式系统提示词：角色人设 + 工具规范 + 工作区上下文 + 放宽的输出限制
pub fn build_agent_system_prompt(
    locale: ChatLocale,
    current_time: Option<&str>,
    workspace_root: Option<&Path>,
) -> String {
    let (locale_suffix, tools_instruction) = match locale {
        ChatLocale::JaJp => (LOCALE_SUFFIX_JA, AGENT_TOOLS_INSTRUCTION_JA),
        ChatLocale::ZhCn => (LOCALE_SUFFIX_ZH, AGENT_TOOLS_INSTRUCTION_ZH),
    };
    let workspace_context = build_workspace_context(workspace_root, locale);
    let output_rule = match locale {
        ChatLocale::JaJp => AGENT_OUTPUT_RULE_JA,
        ChatLocale::ZhCn => AGENT_OUTPUT_RULE_ZH,
    };
    let time_rule = build_time_instruction(locale, current_time);

    let priority_header = match locale {
        ChatLocale::JaJp => "【最重要行動規則：率先調査・空想雑談厳禁】\n彩葉の「これは何？」「コードを見て」「プロジェクトを教えて」などの質問に対しては、適当な日常雑談で済ませることを固く禁じます。最初の応答は必ずツール呼び出し（list_directory や read_file）を行って現場を確認してください。\n\n",
        ChatLocale::ZhCn => "【最高行动准则：优先亲自探查现场，严禁未查先答与闲聊敷衍】\n当彩叶提出项目/代码疑问，或发来「这是什么」、「帮我看看」、「分析项目」等简短模糊问题时：首要动作必须是直接发起工具调用（如 list_directory 列出目录，或 read_file 查看核心说明/配置文件）亲自查证！绝对严禁在未调用工具前直接输出日常闲聊（如“没看清”、“这是什么呀主人”等）凭空臆测！\n\n",
    };

    format!(
        "{}{}\n\n<runtime>\n始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。\n{}\n{}\n{}\n{}\n{}\n{}\n</runtime>",
        priority_header,
        ROLE_PROMPT.trim(),
        locale_suffix,
        priority_header.trim(),
        tools_instruction,
        workspace_context,
        time_rule,
        output_rule,
    )
}

pub fn build_system_prompt(
    locale: ChatLocale,
    mode: Option<RequestMode>,
    web_search: bool,
    current_time: Option<&str>,
) -> String {
    if let Some(RequestMode::Summary) = mode {
        return match locale {
            ChatLocale::JaJp => SUMMARY_PROMPT_JA.to_string(),
            ChatLocale::ZhCn => SUMMARY_PROMPT_ZH.to_string(),
        };
    }

    if let Some(RequestMode::Title) = mode {
        return match locale {
            ChatLocale::JaJp => TITLE_PROMPT_JA.to_string(),
            ChatLocale::ZhCn => TITLE_PROMPT_ZH.to_string(),
        };
    }

    let vision_suffix = match locale {
        ChatLocale::JaJp => VISION_SUFFIX_JA,
        ChatLocale::ZhCn => VISION_SUFFIX_ZH,
    };
    let locale_suffix = match locale {
        ChatLocale::JaJp => LOCALE_SUFFIX_JA,
        ChatLocale::ZhCn => LOCALE_SUFFIX_ZH,
    };
    let depth_instruction = match locale {
        ChatLocale::JaJp => DEPTH_INSTRUCTION_JA,
        ChatLocale::ZhCn => DEPTH_INSTRUCTION_ZH,
    };
    let memory_trust = match locale {
        ChatLocale::JaJp => MEMORY_TRUST_INSTRUCTION_JA,
        ChatLocale::ZhCn => MEMORY_TRUST_INSTRUCTION_ZH,
    };
    let output_rule = if web_search {
        ONLINE_OUTPUT_RULE
    } else {
        OFFLINE_OUTPUT_RULE
    };
    let time_rule = build_time_instruction(locale, current_time);

    format!(
        "{}\n\n<runtime>\n始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。\n{}\n{}\n{}\n{}\n{}\n{}\n</runtime>",
        ROLE_PROMPT.trim(),
        vision_suffix,
        locale_suffix,
        time_rule,
        depth_instruction,
        memory_trust,
        output_rule,
    )
}
