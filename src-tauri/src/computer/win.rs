//! Win32 执行层：SendInput 注入键鼠、EnumWindows 枚举窗口、ShellExecute 启动应用、GDI 截取桌面。
//! 坐标统一为物理像素（应用进程按显示器 DPI 感知运行，与 SetCursorPos/GetWindowRect 口径一致）。

use super::input::{plan_text, Key, TypeUnit};
use super::{bmp, hold_input_guard, Action, AppMode, MouseButton, OVERLAY_WINDOW_TITLE};
use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::{null, null_mut};
use std::collections::HashSet;
use std::time::{Duration, Instant};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEINPUT,
    MOUSE_EVENT_FLAGS, VK_ESCAPE,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateCursor, EnumWindows, GetAncestor, GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW, SetCursorPos,
    SetForegroundWindow, SetSystemCursor, ShowWindow, SystemParametersInfoW, WindowFromPoint, GA_ROOT, OCR_APPSTARTING,
    OCR_CROSS, OCR_HAND, OCR_IBEAM, OCR_NO, OCR_NORMAL, OCR_SIZEALL, OCR_SIZENESW, OCR_SIZENS, OCR_SIZENWSE,
    OCR_SIZEWE, OCR_UP, OCR_WAIT, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, SPI_SETCURSORS, SW_RESTORE, SW_SHOWNORMAL, SYSTEM_CURSOR_ID, WM_CLOSE,
};

const MAX_LISTED_WINDOWS: usize = 40;
/// 启动应用后等待新窗口出现的上限；多数应用 1—3 秒内出窗，慢的启动器也足够
const LAUNCH_WAIT: Duration = Duration::from_secs(10);
const LAUNCH_POLL: Duration = Duration::from_millis(200);
/// 新窗口出现后再等一小会儿，让它完成首帧绘制与控件树构建，inspect 才读得到元素
const LAUNCH_SETTLE: Duration = Duration::from_millis(400);

/// 需要替换为空白的标准系统光标（箭头、文本、手形、等待、缩放等），覆盖鼠标可能显示的全部形态
const SYSTEM_CURSORS: [SYSTEM_CURSOR_ID; 13] = [
    OCR_NORMAL,
    OCR_IBEAM,
    OCR_WAIT,
    OCR_CROSS,
    OCR_UP,
    OCR_SIZENWSE,
    OCR_SIZENESW,
    OCR_SIZEWE,
    OCR_SIZENS,
    OCR_SIZEALL,
    OCR_NO,
    OCR_HAND,
    OCR_APPSTARTING,
];

/// 把所有标准系统光标替换成 32x32 全透明光标（AND 掩码全 1、XOR 掩码全 0）
pub fn hide_system_cursor() {
    let and_mask = [0xFFu8; 32 * 32 / 8];
    let xor_mask = [0u8; 32 * 32 / 8];
    for id in SYSTEM_CURSORS {
        unsafe {
            // SetSystemCursor 会接管并销毁传入的光标句柄，每个 ID 都要单独创建一份
            let blank = CreateCursor(
                null_mut(),
                0,
                0,
                32,
                32,
                and_mask.as_ptr() as *const c_void,
                xor_mask.as_ptr() as *const c_void,
            );
            if !blank.is_null() {
                SetSystemCursor(blank, id);
            }
        }
    }
}

/// 从注册表重新加载用户的光标方案，撤销 hide_system_cursor 的替换
pub fn reload_system_cursors() {
    unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, null_mut(), 0) };
}

pub fn escape_key_down() -> bool {
    (unsafe { GetAsyncKeyState(VK_ESCAPE as i32) } as u16) & 0x8000 != 0
}

pub fn perform(action: Action) -> Result<String, String> {
    match action {
        Action::App { name, mode } => app(&name, mode),
        Action::Click { point, button, clicks } => click(point, button, clicks),
        Action::Type { text } => type_text(&text),
        Action::Shortcut { label, keys } => shortcut(&label, &keys),
        Action::Screenshot => screenshot(),
        Action::Snapshot => Ok(snapshot()),
        Action::Inspect { query } => inspect(query.as_deref()),
    }
}

/// 枚举前台窗口的可点击元素；前台是八千代自身时拒绝
fn inspect(query: Option<&str>) -> Result<String, String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return Err("当前没有前台窗口，请先用 app 启动或切换到目标应用".to_string());
    }
    if is_own_window(hwnd) {
        return Err("当前前台窗口是月见八千代自身，请先用 app（launch 或 focus）切换到目标应用再 inspect".to_string());
    }
    super::uia::inspect(hwnd as isize, &window_title(hwnd), query)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

struct WindowInfo {
    hwnd: HWND,
    pid: u32,
    title: String,
    exe: String,
    rect: RECT,
    minimized: bool,
}

fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}

fn process_exe(pid: u32) -> String {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or_default().to_string()
    }
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam as *mut Vec<HWND>);
    list.push(hwnd);
    1
}

/// 可见且有标题的顶层窗口，按 Z 序（前台在前）；排除遮罩与桌面本身
fn list_windows() -> Vec<WindowInfo> {
    let mut handles: Vec<HWND> = Vec::new();
    unsafe { EnumWindows(Some(collect_window), &mut handles as *mut Vec<HWND> as LPARAM) };
    handles
        .into_iter()
        .filter(|&hwnd| unsafe { IsWindowVisible(hwnd) } != 0)
        .filter_map(|hwnd| {
            let title = window_title(hwnd);
            if title.trim().is_empty() || title == OVERLAY_WINDOW_TITLE || title == "Program Manager" {
                return None;
            }
            let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            unsafe { GetWindowRect(hwnd, &mut rect) };
            let pid = window_pid(hwnd);
            Some(WindowInfo {
                hwnd,
                pid,
                title,
                exe: process_exe(pid),
                rect,
                minimized: unsafe { IsIconic(hwnd) } != 0,
            })
        })
        .collect()
}

/// 先按可执行文件名（忽略 .exe 与大小写）精确匹配，再按标题包含匹配；不匹配八千代自身窗口
fn find_window(query: &str) -> Option<WindowInfo> {
    let needle = query.trim().to_lowercase();
    let stem = |name: &str| name.strip_suffix(".exe").unwrap_or(name).to_string();
    let needle_stem = stem(&needle);
    let own = unsafe { GetCurrentProcessId() };
    let mut windows: Vec<WindowInfo> = list_windows().into_iter().filter(|w| w.pid != own).collect();
    let index = windows
        .iter()
        .position(|w| stem(&w.exe.to_lowercase()) == needle_stem)
        .or_else(|| windows.iter().position(|w| w.title.to_lowercase().contains(&needle)))?;
    Some(windows.swap_remove(index))
}

fn is_own_window(hwnd: HWND) -> bool {
    !hwnd.is_null() && window_pid(hwnd) == unsafe { GetCurrentProcessId() } && window_title(hwnd) != OVERLAY_WINDOW_TITLE
}

/// 键盘输入发往前台窗口；前台是八千代自身时拒绝，避免模型改写自己的输入框或设置
fn ensure_foreground_not_self() -> Result<(), String> {
    if is_own_window(unsafe { GetForegroundWindow() }) {
        return Err("当前前台窗口是月见八千代自身，请先调用 app（action 为 launch 或 focus）切换到目标应用".to_string());
    }
    Ok(())
}

/// 点击落在八千代自身窗口时拒绝，避免模型点击批准按钮或切换执行模式
fn ensure_point_not_self(x: i32, y: i32) -> Result<(), String> {
    let root = unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) };
    if is_own_window(root) {
        return Err(format!("坐标 ({}, {}) 位于月见八千代自身窗口上，桌面控制不能操作八千代界面", x, y));
    }
    Ok(())
}

fn send(inputs: &[INPUT]) -> Result<(), String> {
    if inputs.is_empty() {
        return Ok(());
    }
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
    if sent as usize != inputs.len() {
        return Err("输入被系统拦截：目标窗口可能以管理员权限运行，或当前处于锁屏/安全桌面".to_string());
    }
    Ok(())
}

fn keyboard_input(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn key_input(key: Key, up: bool) -> INPUT {
    let mut flags = if key.extended { KEYEVENTF_EXTENDEDKEY } else { 0 };
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    keyboard_input(key.vk, 0, flags)
}

fn mouse_input(flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

struct VirtualScreen {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

fn virtual_screen() -> VirtualScreen {
    unsafe {
        VirtualScreen {
            left: GetSystemMetrics(SM_XVIRTUALSCREEN),
            top: GetSystemMetrics(SM_YVIRTUALSCREEN),
            width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
            height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
        }
    }
}

fn cursor_position() -> (i32, i32) {
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point) };
    (point.x, point.y)
}

fn click(point: Option<(i32, i32)>, button: MouseButton, clicks: u32) -> Result<String, String> {
    let (x, y) = match point {
        Some((x, y)) => {
            let screen = virtual_screen();
            if x < screen.left || y < screen.top || x >= screen.left + screen.width || y >= screen.top + screen.height {
                return Err(format!(
                    "坐标 ({}, {}) 超出屏幕范围 ({}, {}) - ({}, {})",
                    x,
                    y,
                    screen.left,
                    screen.top,
                    screen.left + screen.width - 1,
                    screen.top + screen.height - 1
                ));
            }
            (x, y)
        }
        None => cursor_position(),
    };
    ensure_point_not_self(x, y)?;
    // 点击前先识别目标元素，作为"点中了什么"的实时反馈
    let target = super::uia::describe_point(x, y);
    let (down, up, label) = match button {
        MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, "左键"),
        MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, "右键"),
        MouseButton::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, "中键"),
    };
    hold_input_guard(Duration::from_millis(400));
    if point.is_some() && unsafe { SetCursorPos(x, y) } == 0 {
        return Err(format!("无法把光标移动到 ({}, {})", x, y));
    }
    // 留出悬停时间，部分界面要先收到 mousemove 才会响应点击
    std::thread::sleep(Duration::from_millis(40));
    let inputs: Vec<INPUT> = (0..clicks).flat_map(|_| [mouse_input(down), mouse_input(up)]).collect();
    send(&inputs)?;
    let times = match clicks {
        1 => "单击",
        2 => "双击",
        _ => "三击",
    };
    match target {
        Some(target) => Ok(format!("已在 ({}, {}) {}{} → {}", x, y, label, times, target)),
        None => Ok(format!("已在 ({}, {}) {}{}", x, y, label, times)),
    }
}

fn type_text(text: &str) -> Result<String, String> {
    ensure_foreground_not_self()?;
    let plan = plan_text(text);
    hold_input_guard(Duration::from_millis(300 + plan.len() as u64 * 2));
    // 分批注入，避免目标程序消息队列一次涌入过多字符而丢字
    for chunk in plan.chunks(32) {
        let inputs: Vec<INPUT> = chunk
            .iter()
            .flat_map(|unit| match *unit {
                TypeUnit::Unit(code) => [
                    keyboard_input(0, code, KEYEVENTF_UNICODE),
                    keyboard_input(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
                ],
                TypeUnit::Key(key) => [key_input(key, false), key_input(key, true)],
            })
            .collect();
        send(&inputs)?;
        std::thread::sleep(Duration::from_millis(5));
    }
    Ok(format!("已向前台窗口「{}」键入 {} 个字符", window_title(unsafe { GetForegroundWindow() }), text.chars().count()))
}

fn shortcut(label: &str, keys: &[Key]) -> Result<String, String> {
    ensure_foreground_not_self()?;
    hold_input_guard(Duration::from_millis(300));
    let inputs: Vec<INPUT> = keys
        .iter()
        .map(|k| key_input(*k, false))
        .chain(keys.iter().rev().map(|k| key_input(*k, true)))
        .collect();
    send(&inputs)?;
    Ok(format!("已向前台窗口「{}」发送快捷键 [{}]", window_title(unsafe { GetForegroundWindow() }), label))
}

fn focus_window(info: &WindowInfo) -> Result<(), String> {
    unsafe {
        if IsIconic(info.hwnd) != 0 {
            ShowWindow(info.hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(info.hwnd) == 0 {
            // 前台锁会拒绝后台进程抢焦点；一次 Alt 按键可解除锁定后重试
            let alt = Key { vk: 0x12, extended: false };
            let _ = send(&[key_input(alt, false), key_input(alt, true)]);
            SetForegroundWindow(info.hwnd);
        }
        if GetForegroundWindow() != info.hwnd {
            return Err(format!("系统拒绝把「{}」切换到前台，请让彩叶手动点一下该窗口", info.title));
        }
    }
    Ok(())
}

fn app(name: &str, mode: AppMode) -> Result<String, String> {
    match mode {
        AppMode::Launch => {
            if let Some(info) = find_window(name) {
                focus_window(&info)?;
                return Ok(format!("「{}」已在运行，已切换到前台", info.title));
            }
            let before: HashSet<isize> = list_windows().iter().map(|w| w.hwnd as isize).collect();
            let file = wide(name);
            let verb = wide("open");
            let result = unsafe {
                ShellExecuteW(null_mut(), verb.as_ptr(), file.as_ptr(), null(), null(), SW_SHOWNORMAL)
            };
            let code = result as isize;
            if code <= 32 {
                return Err(format!(
                    "无法启动「{}」（ShellExecute 错误码 {}）：请改用可执行文件名或完整路径，或先用 snapshot 确认是否已在运行",
                    name, code
                ));
            }
            match wait_for_new_window(&before) {
                Some(info) => {
                    // 新窗口通常已在前台；被前台锁挡住时再切一次，切不过去也不算启动失败
                    let _ = focus_window(&info);
                    Ok(format!("已启动「{}」，窗口「{}」（{}）已出现，当前前台：「{}」", name, info.title, info.exe, window_title(unsafe { GetForegroundWindow() })))
                }
                None => Ok(format!(
                    "已发出启动「{}」的请求，但 {} 秒内没有出现新窗口（可能启动较慢或只驻留在托盘），请用 snapshot 确认",
                    name,
                    LAUNCH_WAIT.as_secs()
                )),
            }
        }
        AppMode::Focus => {
            let info = find_window(name).ok_or_else(|| format!("未找到与「{}」匹配的窗口，请先用 snapshot 查看", name))?;
            focus_window(&info)?;
            Ok(format!("已切换到「{}」（{}）", info.title, info.exe))
        }
        AppMode::Close => {
            let info = find_window(name).ok_or_else(|| format!("未找到与「{}」匹配的窗口，请先用 snapshot 查看", name))?;
            // WM_CLOSE 等同点击关闭按钮，程序可以提示保存，不会强行结束进程
            if unsafe { PostMessageW(info.hwnd, WM_CLOSE, 0, 0) } == 0 {
                return Err(format!("向「{}」发送关闭请求失败", info.title));
            }
            Ok(format!("已请求关闭「{}」（{}）", info.title, info.exe))
        }
    }
}

/// 轮询直到出现启动前不存在的顶层窗口（八千代自身除外），以实际出窗代替固定等待
fn wait_for_new_window(before: &HashSet<isize>) -> Option<WindowInfo> {
    let own = unsafe { GetCurrentProcessId() };
    let deadline = Instant::now() + LAUNCH_WAIT;
    while Instant::now() < deadline {
        std::thread::sleep(LAUNCH_POLL);
        if let Some(info) = list_windows().into_iter().find(|w| w.pid != own && !before.contains(&(w.hwnd as isize))) {
            std::thread::sleep(LAUNCH_SETTLE);
            return Some(info);
        }
    }
    None
}

fn snapshot() -> String {
    let screen = virtual_screen();
    let (primary_w, primary_h) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
    let (cx, cy) = cursor_position();
    let foreground = unsafe { GetForegroundWindow() };
    let mut out = format!(
        "坐标单位：物理像素\n虚拟桌面：({}, {}) 起，{}x{}；主屏 {}x{}\n光标：({}, {})\n可见窗口（Z 序，靠前者在上层）：\n",
        screen.left, screen.top, screen.width, screen.height, primary_w, primary_h, cx, cy
    );
    let windows = list_windows();
    for info in windows.iter().take(MAX_LISTED_WINDOWS) {
        let mut tags = Vec::new();
        if info.hwnd == foreground {
            tags.push("前台");
        }
        if info.minimized {
            tags.push("最小化");
        }
        if info.pid == unsafe { GetCurrentProcessId() } {
            tags.push("八千代自身");
        }
        let tags = if tags.is_empty() { String::new() } else { format!("[{}] ", tags.join("/")) };
        let r = info.rect;
        out.push_str(&format!(
            "- {}{} — {} pid={} 位置 ({}, {}) 大小 {}x{}\n",
            tags,
            info.title,
            if info.exe.is_empty() { "未知进程" } else { &info.exe },
            info.pid,
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top
        ));
    }
    if windows.len() > MAX_LISTED_WINDOWS {
        out.push_str(&format!("（另有 {} 个窗口未列出）\n", windows.len() - MAX_LISTED_WINDOWS));
    }
    out.push_str("要点击窗口内的按钮或输入框，请用 inspect 获取元素的准确坐标，不要凭窗口位置估算。\n");
    out
}

fn screenshot() -> Result<String, String> {
    let screen = virtual_screen();
    let (width, height) = (screen.width.max(1) as u32, screen.height.max(1) as u32);
    let stride = bmp::row_stride(width);
    let mut pixels = vec![0u8; stride * height as usize];
    unsafe {
        let screen_dc = GetDC(null_mut());
        if screen_dc.is_null() {
            return Err("无法获取屏幕设备上下文".to_string());
        }
        let mem_dc = CreateCompatibleDC(screen_dc);
        let bitmap = CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
        let previous = SelectObject(mem_dc, bitmap);
        let copied = BitBlt(mem_dc, 0, 0, width as i32, height as i32, screen_dc, screen.left, screen.top, SRCCOPY | CAPTUREBLT);
        // GetDIBits 要求位图未被选入任何 DC
        SelectObject(mem_dc, previous);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: height as i32,
            biPlanes: 1,
            biBitCount: 24,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let lines = GetDIBits(mem_dc, bitmap, 0, height, pixels.as_mut_ptr() as *mut c_void, &mut info, DIB_RGB_COLORS);
        DeleteObject(bitmap);
        DeleteDC(mem_dc);
        ReleaseDC(null_mut(), screen_dc);
        if copied == 0 || lines as u32 != height {
            return Err("截取屏幕失败".to_string());
        }
    }
    let data = bmp::encode_bmp(width, height, &pixels)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("yachiyo-screenshot-{}.bmp", stamp));
    std::fs::write(&path, data).map_err(|e| format!("保存截图失败: {}", e))?;
    Ok(format!("已截取整个桌面（{}x{}），保存到 {}", width, height, path.display()))
}
