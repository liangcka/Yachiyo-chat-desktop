//! 输入解析：把模型给出的快捷键与文本转换为与平台无关的按键序列，Win32 层只负责逐个注入。

/// 一个虚拟键；方向键、Home/End、Win 等位于扩展键区，注入时必须带 EXTENDEDKEY 标志才不会被识别成小键盘键
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key {
    pub vk: u16,
    pub extended: bool,
}

const fn key(vk: u16) -> Key {
    Key { vk, extended: false }
}

const fn extended(vk: u16) -> Key {
    Key { vk, extended: true }
}

pub const VK_RETURN: Key = key(0x0D);
pub const VK_TAB: Key = key(0x09);

fn modifier(name: &str) -> Option<Key> {
    match name {
        "ctrl" | "control" => Some(key(0x11)),
        "shift" => Some(key(0x10)),
        "alt" => Some(key(0x12)),
        "win" | "windows" | "meta" | "cmd" | "super" => Some(extended(0x5B)),
        _ => None,
    }
}

fn named_key(name: &str) -> Option<Key> {
    let k = match name {
        "enter" | "return" => VK_RETURN,
        "esc" | "escape" => key(0x1B),
        "tab" => VK_TAB,
        "space" => key(0x20),
        "backspace" => key(0x08),
        "delete" | "del" => extended(0x2E),
        "insert" | "ins" => extended(0x2D),
        "home" => extended(0x24),
        "end" => extended(0x23),
        "pageup" | "pgup" => extended(0x21),
        "pagedown" | "pgdn" => extended(0x22),
        "left" => extended(0x25),
        "up" => extended(0x26),
        "right" => extended(0x27),
        "down" => extended(0x28),
        "printscreen" | "prtsc" => key(0x2C),
        "capslock" => key(0x14),
        "menu" | "apps" => extended(0x5D),
        "plus" => key(0xBB),
        "minus" => key(0xBD),
        _ => return function_key(name),
    };
    Some(k)
}

fn function_key(name: &str) -> Option<Key> {
    let n: u16 = name.strip_prefix('f')?.parse().ok()?;
    (1..=24).contains(&n).then(|| key(0x70 + n - 1))
}

fn char_key(c: char) -> Option<Key> {
    let vk = match c {
        'a'..='z' => c.to_ascii_uppercase() as u16,
        '0'..='9' => c as u16,
        ';' => 0xBA,
        '=' => 0xBB,
        ',' => 0xBC,
        '-' => 0xBD,
        '.' => 0xBE,
        '/' => 0xBF,
        '`' => 0xC0,
        '[' => 0xDB,
        '\\' => 0xDC,
        ']' => 0xDD,
        '\'' => 0xDE,
        _ => return None,
    };
    Some(key(vk))
}

/// 解析 `ctrl+shift+t`、`win+d`、`alt+f4`、`enter` 形式的组合键：
/// 返回按下顺序（修饰键在前），注入时按此顺序按下、逆序抬起
pub fn parse_shortcut(raw: &str) -> Result<Vec<Key>, String> {
    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("快捷键不能为空".to_string());
    }
    let tokens: Vec<&str> = normalized.split('+').map(str::trim).collect();
    if tokens.iter().any(|t| t.is_empty()) {
        return Err(format!("无法解析快捷键 '{}'：按键之间用 + 连接，如 ctrl+shift+t", raw));
    }
    let (last, modifiers) = tokens.split_last().expect("tokens 非空");
    let mut keys = Vec::with_capacity(tokens.len());
    for name in modifiers {
        let k = modifier(name)
            .ok_or_else(|| format!("'{}' 不是修饰键：组合键中只有最后一个可以是普通键（如 ctrl+shift+t）", name))?;
        if !keys.contains(&k) {
            keys.push(k);
        }
    }
    let main = modifier(last)
        .or_else(|| named_key(last))
        .or_else(|| {
            let mut chars = last.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => char_key(c),
                _ => None,
            }
        })
        .ok_or_else(|| format!("不支持的按键 '{}'", last))?;
    if !keys.contains(&main) {
        keys.push(main);
    }
    Ok(keys)
}

/// 文本注入单元：普通字符按 UTF-16 码元以 Unicode 方式注入（不受键盘布局与输入法影响），
/// 换行与制表符改按真实按键，保证在聊天框、表单中触发对应行为
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeUnit {
    Unit(u16),
    Key(Key),
}

pub fn plan_text(text: &str) -> Vec<TypeUnit> {
    let mut plan = Vec::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                plan.push(TypeUnit::Key(VK_RETURN));
            }
            '\n' => plan.push(TypeUnit::Key(VK_RETURN)),
            '\t' => plan.push(TypeUnit::Key(VK_TAB)),
            _ => {
                let mut buf = [0u16; 2];
                plan.extend(c.encode_utf16(&mut buf).iter().map(|u| TypeUnit::Unit(*u)));
            }
        }
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modifier_combos_in_press_order() {
        assert_eq!(parse_shortcut("Ctrl+Shift+T").unwrap(), vec![key(0x11), key(0x10), key(0x54)]);
        assert_eq!(parse_shortcut("win+d").unwrap(), vec![extended(0x5B), key(0x44)]);
        assert_eq!(parse_shortcut("alt + f4").unwrap(), vec![key(0x12), key(0x73)]);
        assert_eq!(parse_shortcut("enter").unwrap(), vec![VK_RETURN]);
        assert_eq!(parse_shortcut("win").unwrap(), vec![extended(0x5B)]);
        assert_eq!(parse_shortcut("ctrl+left").unwrap(), vec![key(0x11), extended(0x25)]);
        assert_eq!(parse_shortcut("ctrl+/").unwrap(), vec![key(0x11), key(0xBF)]);
    }

    #[test]
    fn rejects_malformed_shortcuts() {
        assert!(parse_shortcut("").is_err());
        assert!(parse_shortcut("ctrl+").is_err());
        assert!(parse_shortcut("a+ctrl").is_err());
        assert!(parse_shortcut("ctrl+f25").is_err());
        assert!(parse_shortcut("ctrl+中").is_err());
    }

    #[test]
    fn plans_text_with_real_enter_and_utf16_units() {
        let plan = plan_text("好a\r\nb\t😀");
        assert_eq!(plan[0], TypeUnit::Unit('好' as u16));
        assert_eq!(plan[1], TypeUnit::Unit('a' as u16));
        assert_eq!(plan[2], TypeUnit::Key(VK_RETURN));
        assert_eq!(plan[3], TypeUnit::Unit('b' as u16));
        assert_eq!(plan[4], TypeUnit::Key(VK_TAB));
        // 补充平面字符拆成代理对两个码元
        assert_eq!(plan.len(), 7);
    }
}
