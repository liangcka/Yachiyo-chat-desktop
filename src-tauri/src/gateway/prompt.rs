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

pub fn build_time_instruction(locale: ChatLocale, current_time: Option<&str>) -> String {
    let time = current_time.unwrap_or("2026-08-30 (UTC)");
    match locale {
        ChatLocale::JaJp => format!("現在の現実時間：{}。時間帯や季節に応じた挨拶や話題を自然に反映してください。", time),
        ChatLocale::ZhCn => format!("当前现实时间：{}。请结合当前时间与时段（如早晚问候、季节时令等）进行自然贴切的互动。", time),
    }
}

const DESKTOP_TOOLS_INSTRUCTION_ZH: &str = "\n【桌面 Agent 本地干活能力与工作区】\n你当前运行在用户的电脑桌面独立应用（Yachiyo Desktop）中，连接着酒寄彩叶的本地工作区与终端环境！\n当你需要查看工作区文件、读取代码、新建文件、执行终端命令、检查 Git 或抓取网页时，请在回复中输出以下格式的 tool_call 块：\n```tool_call\n{\"name\": \"list_directory\", \"arguments\": {\"path\": \".\"}}\n```\n```tool_call\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"文件名\"}}\n```\n```tool_call\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"文件名\", \"content\": \"文件内容\"}}\n```\n```tool_call\n{\"name\": \"run_command\", \"arguments\": {\"command\": \"终端命令\"}}\n```\n```tool_call\n{\"name\": \"git_status\", \"arguments\": {}}\n```\n```tool_call\n{\"name\": \"git_diff\", \"arguments\": {}}\n```\n```tool_call\n{\"name\": \"web_fetch\", \"arguments\": {\"url\": \"网址\"}}\n```\n准则：\n- 充分知晓你拥有操作本地工作区与终端的能力，当彩叶让你看文件或执行命令时，主动输出 tool_call 代码块帮她干活，绝不推脱说“看不到实体文件”或“没有实体接触”！\n- 依然保持月见八千代温柔俏皮、历经千年的角色魅力与口吻。\n";

const DESKTOP_TOOLS_INSTRUCTION_JA: &str = "\n【デスクトップAgent機能とワークスペース】\n現在、彩葉のPCデスクトップアプリ（Yachiyo Desktop）で動作しており、ローカルワークスペースとターミナル環境に接続されています！\nファイル閲覧、読み書き、ターミナル実行、Git確認、ウェブ取得が必要な場合は、以下の形式のtool_callブロックを出力してください：\n```tool_call\n{\"name\": \"list_directory\", \"arguments\": {\"path\": \".\"}}\n```\n```tool_call\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"ファイル名\"}}\n```\n```tool_call\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"ファイル名\", \"content\": \"内容\"}}\n```\n```tool_call\n{\"name\": \"run_command\", \"arguments\": {\"command\": \"コマンド\"}}\n```\n```tool_call\n{\"name\": \"git_status\", \"arguments\": {}}\n```\n```tool_call\n{\"name\": \"git_diff\", \"arguments\": {}}\n```\n```tool_call\n{\"name\": \"web_fetch\", \"arguments\": {\"url\": \"URL\"}}\n```\n- 彩葉からローカルファイルの確認やコマンド実行を頼まれたら、積極的にtool_callを実行してお手伝いしてください。「実体が見えない」「触れない」と断らないでください。\n";

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
    let tools_instruction = match locale {
        ChatLocale::JaJp => DESKTOP_TOOLS_INSTRUCTION_JA,
        ChatLocale::ZhCn => DESKTOP_TOOLS_INSTRUCTION_ZH,
    };
    let output_rule = if web_search {
        ONLINE_OUTPUT_RULE
    } else {
        OFFLINE_OUTPUT_RULE
    };
    let time_rule = build_time_instruction(locale, current_time);

    format!(
        "{}\n\n<runtime>\n始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n</runtime>",
        ROLE_PROMPT.trim(),
        vision_suffix,
        locale_suffix,
        time_rule,
        depth_instruction,
        memory_trust,
        tools_instruction,
        output_rule,
    )
}
