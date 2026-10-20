//! UI Automation：枚举前台窗口的可点击元素并给出中心坐标，让模型据此精确点击，
//! 而不是凭截图猜坐标（模型看不到截图）。同时提供"某坐标处是什么元素"用于点击后的实时反馈。

use uiautomation::types::{ControlType, Handle, Point};
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

const MAX_ELEMENTS: usize = 40;
const MAX_VISITS: usize = 1500;
const MAX_DEPTH: usize = 40;
const MAX_NAME_CHARS: usize = 32;

struct Element {
    label: &'static str,
    name: String,
    x: i32,
    y: i32,
}

/// 按字符边界截断，避免把中文截成半个字
fn truncate(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let kept: String = trimmed.chars().take(max_chars).collect();
    format!("{}…", kept)
}

/// 可交互的控件类型 → 中文标签；返回 None 表示该类型不作为可点击元素收集
fn actionable_label(control_type: ControlType) -> Option<&'static str> {
    Some(match control_type {
        ControlType::Button | ControlType::SplitButton => "按钮",
        ControlType::Edit | ControlType::Document => "编辑框",
        ControlType::Hyperlink => "链接",
        ControlType::CheckBox => "复选框",
        ControlType::RadioButton => "单选项",
        ControlType::ComboBox => "下拉框",
        ControlType::ListItem => "列表项",
        ControlType::MenuItem => "菜单项",
        ControlType::TabItem => "标签页",
        ControlType::TreeItem => "树节点",
        _ => return None,
    })
}

/// 元素的点击点：优先用 UIA 给出的 clickable point，否则取包围盒中心；不可定位时返回 None
fn click_point(element: &UIElement) -> Option<(i32, i32)> {
    if let Ok(Some(point)) = element.get_clickable_point() {
        return Some((point.get_x(), point.get_y()));
    }
    let rect = element.get_bounding_rectangle().ok()?;
    let (w, h) = (rect.get_width(), rect.get_height());
    if w <= 0 || h <= 0 {
        return None;
    }
    Some((rect.get_left() + w / 2, rect.get_top() + h / 2))
}

fn describe(element: &UIElement) -> Option<Element> {
    let control_type = element.get_control_type().ok()?;
    // 可聚焦的文本常被应用当作可点按钮，一并收录；其余非交互类型跳过
    let label = actionable_label(control_type).or_else(|| {
        matches!(control_type, ControlType::Text)
            .then(|| element.is_keyboard_focusable().unwrap_or(false))
            .unwrap_or(false)
            .then_some("文本")
    })?;
    if element.is_offscreen().unwrap_or(false) || !element.is_enabled().unwrap_or(true) {
        return None;
    }
    let name = element.get_name().map(|n| truncate(&n, MAX_NAME_CHARS)).unwrap_or_default();
    // 编辑框即使没有可读名称也值得收录（供输入定位），其余必须有名称才有意义
    if name.is_empty() && label != "编辑框" {
        return None;
    }
    let (x, y) = click_point(element)?;
    Some(Element { label, name, x, y })
}

/// 名称筛选：忽略大小写的包含匹配；未给关键词时全部收录
fn matches_query(name: &str, query: Option<&str>) -> bool {
    query.map_or(true, |q| name.to_lowercase().contains(&q.to_lowercase()))
}

fn walk(
    walker: &UITreeWalker,
    element: &UIElement,
    depth: usize,
    query: Option<&str>,
    visits: &mut usize,
    out: &mut Vec<Element>,
) {
    if depth > MAX_DEPTH || *visits >= MAX_VISITS || out.len() >= MAX_ELEMENTS {
        return;
    }
    *visits += 1;
    if let Some(found) = describe(element).filter(|found| matches_query(&found.name, query)) {
        // 坐标接近、标签与名称相同的元素视为重复（容器与其命中区常重叠）
        let dup = out
            .iter()
            .any(|e| e.label == found.label && e.name == found.name && (e.x - found.x).abs() <= 4 && (e.y - found.y).abs() <= 4);
        if !dup {
            out.push(found);
        }
    }
    let mut child = walker.get_first_child(element).ok();
    while let Some(node) = child {
        walk(walker, &node, depth + 1, query, visits, out);
        if out.len() >= MAX_ELEMENTS || *visits >= MAX_VISITS {
            break;
        }
        child = walker.get_next_sibling(&node).ok();
    }
}

/// 枚举指定前台窗口的可点击元素（hwnd 以 isize 传入，避免 windows / windows-sys 的 HWND 类型差异）
pub fn inspect(hwnd: isize, window_title: &str, query: Option<&str>) -> Result<String, String> {
    let automation = UIAutomation::new().map_err(|e| format!("UI Automation 初始化失败: {}", e))?;
    let root = automation
        .element_from_handle(Handle::from(hwnd))
        .map_err(|e| format!("无法读取前台窗口的元素树: {}", e))?;
    let walker = automation
        .get_control_view_walker()
        .map_err(|e| format!("无法遍历元素树: {}", e))?;

    let mut out = Vec::new();
    let mut visits = 0usize;
    walk(&walker, &root, 0, query, &mut visits, &mut out);

    if out.is_empty() {
        if let Some(q) = query {
            return Ok(format!(
                "前台窗口「{}」中没有名称包含「{}」的可点击元素。可以换个关键词，或不带 query 查看全部元素。",
                window_title, q
            ));
        }
        return Ok(format!(
            "前台窗口「{}」没有读取到可点击元素（可能是全自绘界面或未暴露无障碍信息）。可以改用 screenshot 让彩叶查看，或请彩叶描述界面。",
            window_title
        ));
    }
    let scope = query.map(|q| format!("名称包含「{}」的", q)).unwrap_or_default();
    let mut text = format!("前台窗口「{}」{}可点击元素（坐标为中心点物理像素，直接用于 click）：\n", window_title, scope);
    for (index, element) in out.iter().enumerate() {
        let name = if element.name.is_empty() { String::new() } else { format!(" \"{}\"", element.name) };
        text.push_str(&format!("[{}] {}{} ({}, {})\n", index + 1, element.label, name, element.x, element.y));
    }
    // 截断后目标元素可能不在列表里，提示用 query 精确查找，而不是凭位置猜
    if out.len() >= MAX_ELEMENTS || visits >= MAX_VISITS {
        text.push_str("（元素较多，只列出了一部分；找不到目标时传 query 按名称筛选）\n");
    }
    Ok(text)
}

/// 描述某坐标处的元素，用作点击后的实时反馈；无法识别时返回 None
pub fn describe_point(x: i32, y: i32) -> Option<String> {
    let automation = UIAutomation::new().ok()?;
    let element = automation.element_from_point(Point::new(x, y)).ok()?;
    let label = element.get_control_type().ok().and_then(actionable_label).unwrap_or("元素");
    match element.get_name().ok().map(|n| truncate(&n, MAX_NAME_CHARS)).filter(|n| !n.is_empty()) {
        Some(name) => Some(format!("{}「{}」", label, name)),
        None => Some(label.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_keeps_char_boundaries() {
        assert_eq!(truncate("  表情  ", 32), "表情");
        assert_eq!(truncate("搜索框", 2), "搜索…");
        assert_eq!(truncate("abc", 10), "abc");
    }

    #[test]
    fn query_matches_names_case_insensitively() {
        assert!(matches_query("发送(S)", Some("发送")));
        assert!(matches_query("Send", Some("send")));
        assert!(!matches_query("表情", Some("发送")));
        assert!(matches_query("", None));
    }

    #[test]
    fn actionable_label_covers_common_controls() {
        assert_eq!(actionable_label(ControlType::Button), Some("按钮"));
        assert_eq!(actionable_label(ControlType::Edit), Some("编辑框"));
        assert_eq!(actionable_label(ControlType::Image), None);
        assert_eq!(actionable_label(ControlType::Pane), None);
    }
}
