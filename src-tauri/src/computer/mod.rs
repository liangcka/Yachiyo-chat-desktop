//! 内置桌面控制。对外沿用 `windows_mcp` 服务 ID 与 `mcp__windows_mcp__*` 工具名，
//! 权限键、提示词与前端的电脑控制判定都不受影响；执行在进程内通过 Win32 完成，不拉起外部 MCP 进程。

// 编码与按键规划只被 Windows 执行层调用，其他平台保留以便单元测试覆盖
#[cfg_attr(not(windows), allow(dead_code))]
mod bmp;
#[cfg_attr(not(windows), allow(dead_code))]
mod input;
#[cfg(windows)]
mod uia;
pub mod vision;
#[cfg(windows)]
mod win;

use crate::mcp::McpTool;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use input::Key;

/// 内置桌面控制在 MCP 服务列表中的 ID，启停由设置「插件」页的电脑控制开关写入该条目
pub const BUILTIN_SERVER_ID: &str = "windows_mcp";

/// 暴露给模型的工具名前缀（`mcp__{服务 ID}__`），用于判断本次运行是否带有桌面控制
pub const TOOL_PREFIX: &str = "mcp__windows_mcp__";

/// 全屏控制遮罩窗口标题（与 tauri.conf.json 中 control_overlay 一致），注入前的自身窗口判定需排除它
pub const OVERLAY_WINDOW_TITLE: &str = "Yachiyo Computer Control";

const UNSUPPORTED: &str = "桌面控制目前仅支持 Windows";
const MAX_TYPE_CHARS: usize = 5000;

pub fn is_supported() -> bool {
    cfg!(windows)
}

static INPUT_GUARD_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 是否处于合成输入期间（含收尾余量）；全局 Esc 检测据此排除模型自己发送的按键
pub fn synthetic_input_active() -> bool {
    now_ms() < INPUT_GUARD_UNTIL_MS.load(Ordering::SeqCst)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn hold_input_guard(duration: Duration) {
    INPUT_GUARD_UNTIL_MS.fetch_max(now_ms() + duration.as_millis() as u64, Ordering::SeqCst);
}

#[cfg(windows)]
static CURSOR_HIDDEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 控制期间把系统光标换成空白，屏幕上只留遮罩绘制的八千代光标；重复调用无副作用
pub fn hide_system_cursor() {
    #[cfg(windows)]
    if !CURSOR_HIDDEN.swap(true, Ordering::SeqCst) {
        win::hide_system_cursor();
    }
}

/// 恢复用户的系统光标方案；未隐藏时不做任何事
pub fn restore_system_cursor() {
    #[cfg(windows)]
    if CURSOR_HIDDEN.swap(false, Ordering::SeqCst) {
        win::reload_system_cursors();
    }
}

/// 启动时无条件重载光标方案：上次若在控制中途被强制结束，系统光标会一直是空白
pub fn recover_system_cursor() {
    #[cfg(windows)]
    win::reload_system_cursors();
}

/// 用户是否按下了物理 Esc；合成输入期间一律视为未按，避免模型自己发送的 Esc 把运行停掉
pub fn escape_pressed() -> bool {
    #[cfg(windows)]
    {
        !synthetic_input_active() && win::escape_key_down()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMode {
    Launch,
    Focus,
    Close,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    App { name: String, mode: AppMode },
    /// point 为空表示在光标当前位置点击
    Click { point: Option<(i32, i32)>, button: MouseButton, clicks: u32 },
    Type { text: String },
    Shortcut { label: String, keys: Vec<Key> },
    Screenshot,
    /// 截取画面交给模型查看；window 为前台窗口，否则为整个屏幕
    Look { window: bool },
    Snapshot,
    /// 枚举前台窗口的可点击元素及其中心坐标，供模型据此精确点击；query 按名称筛选
    Inspect { query: Option<String> },
}

fn coordinate(args: &serde_json::Value, field: &str) -> Result<Option<i32>, String> {
    match args.get(field) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|v| v.is_finite())
            .map(|v| Some(v.round() as i32))
            .ok_or_else(|| format!("坐标 '{}' 必须是数字", field)),
    }
}

/// look 截图上的坐标换算为屏幕坐标，模型不需要自己做缩放换算
fn image_point(args: &serde_json::Value) -> Result<Option<(i32, i32)>, String> {
    let read = |field: &str| match args.get(field) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|v| v.is_finite())
            .map(Some)
            .ok_or_else(|| format!("坐标 '{}' 必须是数字", field)),
    };
    match (read("image_x")?, read("image_y")?) {
        (None, None) => Ok(None),
        (Some(x), Some(y)) => {
            let mapping = vision::last_capture().ok_or("还没有截图可供换算，请先用 look 查看画面")?;
            mapping.to_screen(x, y).map(Some).ok_or_else(|| {
                format!(
                    "图上坐标 ({}, {}) 超出最近一次截图范围 {}x{}",
                    x, y, mapping.image_width, mapping.image_height
                )
            })
        }
        _ => Err("image_x 与 image_y 需要同时提供".to_string()),
    }
}

/// 把工具参数解析为动作；参数错误在此统一返回给模型，Win32 层只处理已校验的输入
pub fn parse_action(tool: &str, args: &serde_json::Value) -> Result<Action, String> {
    let text_arg = |field: &str| args.get(field).and_then(|v| v.as_str()).map(str::trim).unwrap_or_default();
    match tool {
        "app" => {
            let name = text_arg("name");
            if name.is_empty() {
                return Err("缺少应用名称 'name'".to_string());
            }
            let mode = match text_arg("action") {
                "" | "launch" => AppMode::Launch,
                "focus" => AppMode::Focus,
                "close" => AppMode::Close,
                other => return Err(format!("不支持的 action '{}'，可选 launch / focus / close", other)),
            };
            Ok(Action::App { name: name.to_string(), mode })
        }
        "click" => {
            let point = match (coordinate(args, "x")?, coordinate(args, "y")?, image_point(args)?) {
                (Some(x), Some(y), None) => Some((x, y)),
                (None, None, Some(point)) => Some(point),
                (None, None, None) => None,
                (_, _, Some(_)) => return Err("x/y 与 image_x/image_y 只能二选一".to_string()),
                _ => return Err("x 与 y 需要同时提供；都省略时在光标当前位置点击".to_string()),
            };
            let button = match text_arg("button") {
                "" | "left" => MouseButton::Left,
                "right" => MouseButton::Right,
                "middle" => MouseButton::Middle,
                other => return Err(format!("不支持的鼠标按键 '{}'，可选 left / right / middle", other)),
            };
            let clicks = match args.get("clicks").and_then(|v| v.as_f64()) {
                None => 1,
                Some(n) if (1.0..=3.0).contains(&n) => n.round() as u32,
                Some(n) => return Err(format!("clicks 取值 1-3，收到 {}", n)),
            };
            Ok(Action::Click { point, button, clicks })
        }
        "type" => {
            let text = args.get("text").and_then(|v| v.as_str()).unwrap_or_default();
            if text.is_empty() {
                return Err("缺少文本内容 'text'".to_string());
            }
            if text.chars().count() > MAX_TYPE_CHARS {
                return Err(format!("单次键入不超过 {} 个字符，请分段输入", MAX_TYPE_CHARS));
            }
            Ok(Action::Type { text: text.to_string() })
        }
        "shortcut" => {
            let label = text_arg("shortcut");
            let keys = input::parse_shortcut(label)?;
            Ok(Action::Shortcut { label: label.to_string(), keys })
        }
        "screenshot" => Ok(Action::Screenshot),
        "look" => match text_arg("scope") {
            "" | "window" => Ok(Action::Look { window: true }),
            "screen" => Ok(Action::Look { window: false }),
            other => Err(format!("不支持的 scope '{}'，可选 window / screen", other)),
        },
        "snapshot" => Ok(Action::Snapshot),
        "inspect" => {
            let query = text_arg("query");
            Ok(Action::Inspect { query: (!query.is_empty()).then(|| query.to_string()) })
        }
        other => Err(format!("未知的桌面控制工具: {}", other)),
    }
}

/// 动作完成后的等待：给目标窗口时间完成启动、切换或重绘，避免下一步操作落在旧界面上
#[cfg_attr(not(windows), allow(dead_code))]
fn settle_after(action: &Action) -> Duration {
    Duration::from_millis(match action {
        // 启动已在执行层等到新窗口出现
        Action::App { mode: AppMode::Launch, .. } => 0,
        Action::App { .. } => 400,
        Action::Click { .. } | Action::Type { .. } | Action::Shortcut { .. } => 150,
        Action::Screenshot | Action::Look { .. } | Action::Snapshot | Action::Inspect { .. } => 0,
    })
}

pub async fn execute(tool: &str, args: &serde_json::Value) -> Result<String, String> {
    let action = parse_action(tool, args)?;
    #[cfg(windows)]
    {
        let settle = settle_after(&action);
        let output = tokio::task::spawn_blocking(move || win::perform(action))
            .await
            .map_err(|e| format!("桌面控制执行中断: {}", e))??;
        tokio::time::sleep(settle).await;
        Ok(output)
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Err(UNSUPPORTED.to_string())
    }
}

/// 不支持的平台返回错误，插件页据此显示不可用原因
pub fn availability() -> Result<(), String> {
    if is_supported() {
        Ok(())
    } else {
        Err(UNSUPPORTED.to_string())
    }
}

/// 工具声明；非 Windows 平台不向模型暴露
pub fn tools() -> Vec<McpTool> {
    if !is_supported() {
        return Vec::new();
    }
    let tool = |name: &str, description: &str, input_schema: serde_json::Value| McpTool {
        name: name.to_string(),
        description: Some(description.to_string()),
        input_schema,
    };
    vec![
        tool(
            "app",
            "启动、切换到或关闭桌面应用。launch 时若已有匹配窗口则直接切到前台，否则启动并等到新窗口出现；结果会回报当前前台窗口。focus/close 按可执行文件名或窗口标题匹配（先用 snapshot 查看）",
            json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "launch 时为程序名、可执行文件或路径（如 notepad、msedge、C:\\\\Program Files\\\\Tencent\\\\QQ\\\\QQ.exe）；focus/close 时为进程名或窗口标题片段" },
                    "action": { "type": "string", "enum": ["launch", "focus", "close"], "description": "默认 launch" }
                },
                "required": ["name"]
            }),
        ),
        tool(
            "inspect",
            "分析前台窗口的可点击元素，返回每个元素的类型、名称与中心坐标。点击前先用它拿到准确坐标，不要凭猜测或估算坐标点击；元素较多或要找特定按钮时传 query 按名称筛选",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "可选，只返回名称包含该文字的元素（不区分大小写），如 发送、搜索" }
                }
            }),
        ),
        tool(
            "click",
            "点击鼠标。坐标二选一：x/y 为 inspect 返回的元素中心（屏幕物理像素）；image_x/image_y 为最近一次 look 截图上的像素位置，由系统换算成屏幕坐标。都省略时在光标当前位置点击。不要自己估算或换算坐标；点击后会回传实际点中的元素名作为反馈",
            json!({
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "屏幕物理像素坐标 X（来自 inspect）" },
                    "y": { "type": "number", "description": "屏幕物理像素坐标 Y（来自 inspect）" },
                    "image_x": { "type": "number", "description": "最近一次 look 截图上的 X（图片像素）" },
                    "image_y": { "type": "number", "description": "最近一次 look 截图上的 Y（图片像素）" },
                    "button": { "type": "string", "enum": ["left", "right", "middle"], "description": "默认 left" },
                    "clicks": { "type": "number", "description": "点击次数 1-3，2 为双击，默认 1" }
                }
            }),
        ),
        tool(
            "type",
            "向当前前台窗口键入文本，支持中文与表情；换行会按回车键发送。前台是八千代自身窗口时会被拒绝，请先用 app 切换到目标应用",
            json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "要输入的文本，单次不超过 5000 字符" }
                },
                "required": ["text"]
            }),
        ),
        tool(
            "shortcut",
            "向当前前台窗口发送组合键，按键用 + 连接，如 enter、ctrl+v、ctrl+shift+t、alt+f4、win+d",
            json!({
                "type": "object",
                "properties": {
                    "shortcut": { "type": "string", "description": "组合键，修饰键在前：ctrl / shift / alt / win" }
                },
                "required": ["shortcut"]
            }),
        ),
        tool(
            "screenshot",
            "把整个桌面截图保存为本地 BMP 文件并返回路径与分辨率，供彩叶查看；这个工具不会把画面交给你，需要自己看画面请用 look",
            json!({ "type": "object", "properties": {} }),
        ),
        tool(
            "look",
            "截取前台窗口（或整个屏幕）的画面交给你查看。用于游戏、自绘界面等 inspect 找不到元素的场景：看图判断界面状态，再用 click 的 image_x/image_y 传图上位置点击。每张图消耗约一千多 token，常规窗口优先用 inspect",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["window", "screen"], "description": "默认 window（前台窗口）；screen 为整个屏幕" }
                }
            }),
        ),
        tool(
            "snapshot",
            "列出屏幕尺寸、光标位置与可见窗口（标题、进程、位置与大小，前台窗口在前），用于决定切换目标与点击坐标",
            json!({ "type": "object", "properties": {} }),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_app_actions() {
        assert_eq!(
            parse_action("app", &json!({ "name": " QQ " })).unwrap(),
            Action::App { name: "QQ".to_string(), mode: AppMode::Launch }
        );
        assert_eq!(
            parse_action("app", &json!({ "name": "wechat", "action": "close" })).unwrap(),
            Action::App { name: "wechat".to_string(), mode: AppMode::Close }
        );
        assert!(parse_action("app", &json!({})).is_err());
        assert!(parse_action("app", &json!({ "name": "qq", "action": "kill" })).is_err());
    }

    #[test]
    fn parses_click_coordinates_and_buttons() {
        assert_eq!(
            parse_action("click", &json!({ "x": 100.4, "y": 200.6, "clicks": 2, "button": "right" })).unwrap(),
            Action::Click { point: Some((100, 201)), button: MouseButton::Right, clicks: 2 }
        );
        assert_eq!(
            parse_action("click", &json!({})).unwrap(),
            Action::Click { point: None, button: MouseButton::Left, clicks: 1 }
        );
        assert!(parse_action("click", &json!({ "x": 10 })).is_err());
        assert!(parse_action("click", &json!({ "x": "10", "y": 5 })).is_err());
        assert!(parse_action("click", &json!({ "x": 1, "y": 1, "clicks": 5 })).is_err());
    }

    #[test]
    fn validates_typed_text_and_shortcuts() {
        assert!(parse_action("type", &json!({ "text": "" })).is_err());
        assert!(parse_action("type", &json!({ "text": "a".repeat(MAX_TYPE_CHARS + 1) })).is_err());
        assert!(matches!(parse_action("type", &json!({ "text": "你好" })).unwrap(), Action::Type { .. }));
        assert!(matches!(
            parse_action("shortcut", &json!({ "shortcut": "alt+f4" })).unwrap(),
            Action::Shortcut { ref keys, .. } if keys.len() == 2
        ));
        assert!(parse_action("shortcut", &json!({})).is_err());
        assert!(parse_action("powershell", &json!({})).is_err());
        assert_eq!(parse_action("inspect", &json!({})).unwrap(), Action::Inspect { query: None });
        assert_eq!(
            parse_action("inspect", &json!({ "query": " 发送 " })).unwrap(),
            Action::Inspect { query: Some("发送".to_string()) }
        );
    }

    #[test]
    fn converts_look_coordinates_for_click() {
        assert_eq!(parse_action("look", &json!({})).unwrap(), Action::Look { window: true });
        assert_eq!(parse_action("look", &json!({ "scope": "screen" })).unwrap(), Action::Look { window: false });
        assert!(parse_action("look", &json!({ "scope": "desk" })).is_err());

        vision::remember_capture(vision::CaptureMapping {
            left: 0,
            top: 0,
            width: 2560,
            height: 1440,
            image_width: 1280,
            image_height: 720,
        });
        assert_eq!(
            parse_action("click", &json!({ "image_x": 100, "image_y": 50 })).unwrap(),
            Action::Click { point: Some((201, 101)), button: MouseButton::Left, clicks: 1 }
        );
        assert!(parse_action("click", &json!({ "image_x": 2000, "image_y": 50 })).is_err());
        assert!(parse_action("click", &json!({ "image_x": 10 })).is_err());
        assert!(parse_action("click", &json!({ "x": 1, "y": 1, "image_x": 1, "image_y": 1 })).is_err());
    }

    #[test]
    fn input_guard_expires() {
        hold_input_guard(Duration::from_millis(200));
        assert!(synthetic_input_active());
        INPUT_GUARD_UNTIL_MS.store(0, Ordering::SeqCst);
        assert!(!synthetic_input_active());
    }

    #[test]
    fn overlay_title_matches_window_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json");
        let overlay = config["app"]["windows"]
            .as_array()
            .and_then(|windows| windows.iter().find(|w| w["label"] == "control_overlay"))
            .expect("control_overlay window");
        assert_eq!(overlay["title"], OVERLAY_WINDOW_TITLE);
    }

    #[test]
    fn exposes_tools_only_on_windows() {
        assert_eq!(tools().is_empty(), !cfg!(windows));
        assert_eq!(availability().is_ok(), cfg!(windows));
    }
}
