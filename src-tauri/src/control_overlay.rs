//! 全屏电脑控制遮罩：显示与隐藏、状态同步、控制期间的光标与 Esc 取消。
//! 遮罩始终鼠标穿透，不拦截任何点击。控制进行时系统光标替换为空白，由遮罩绘制跟随真实位置的八千代光标；
//! 遮罩窗口拿不到焦点，因此由后端轮询物理 Esc 键实现全局取消。

use crate::computer;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const OVERLAY_LABEL: &str = "control_overlay";
const STATE_EVENT: &str = "control_state_change";
const EMERGENCY_STOP_EVENT: &str = "emergency_stop_control";
/// 后端把全局光标位置推给遮罩，驱动八千代光标
const CURSOR_EVENT: &str = "control_cursor_move";
/// 30ms 一次：光标跟随足够平滑，也能捕获一次正常时长的 Esc 按键
const TRACK_INTERVAL: Duration = Duration::from_millis(30);
/// 光标静止时的保底重发周期（以跟踪轮数计，约 0.5 秒）：遮罩在状态切换后才异步订阅光标事件，
/// 首个坐标可能早于订阅到达而丢失，静止时若不再推送，系统光标已隐藏的彩叶会看不到任何光标
const CURSOR_RESEND_TICKS: u32 = 16;

/// paused 表示运行仍在进行但正在等待彩叶审批：状态条保留，系统光标恢复以便点击审批卡片
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlOverlayPayload {
    pub active: bool,
    pub paused: bool,
}

/// 遮罩客户区内的光标位置（物理像素）
#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
struct CursorPosition {
    x: f64,
    y: f64,
}

#[derive(Default)]
pub struct ControlOverlayState {
    payload: Mutex<ControlOverlayPayload>,
    tracking: AtomicBool,
}

impl ControlOverlayState {
    fn current(&self) -> ControlOverlayPayload {
        self.payload.lock().map(|p| p.clone()).unwrap_or_default()
    }

    /// 写入新状态；与当前状态相同时返回 false，调用方据此跳过重复的事件与窗口操作
    fn replace(&self, next: ControlOverlayPayload) -> bool {
        match self.payload.lock() {
            Ok(mut current) if *current != next => {
                *current = next;
                true
            }
            _ => false,
        }
    }
}

/// 控制进行且未暂停时才隐藏系统光标；其余状态一律恢复
fn sync_system_cursor(payload: &ControlOverlayPayload) {
    if payload.active && !payload.paused {
        computer::hide_system_cursor();
    } else {
        computer::restore_system_cursor();
    }
}

fn publish(app: &AppHandle, payload: &ControlOverlayPayload) {
    let _ = app.emit_to(OVERLAY_LABEL, STATE_EVENT, payload);
}

fn deactivate(app: &AppHandle, state: &ControlOverlayState) {
    let payload = ControlOverlayPayload::default();
    computer::restore_system_cursor();
    if state.replace(payload.clone()) {
        publish(app, &payload);
        if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = overlay.hide();
        }
    }
}

/// 紧急取消：通知主窗口中止当前运行并收起遮罩
fn emergency_stop(app: &AppHandle, state: &ControlOverlayState) {
    let _ = app.emit(EMERGENCY_STOP_EVENT, ());
    deactivate(app, state);
}

fn start_tracking(app: AppHandle) {
    if app.state::<ControlOverlayState>().tracking.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        // 光标静止时降为低频重发，遮罩窗口无需每 30ms 重渲一次光标
        let mut last_cursor: Option<(f64, f64)> = None;
        let mut ticks_since_emit: u32 = 0;
        loop {
            tokio::time::sleep(TRACK_INTERVAL).await;
            let state = app.state::<ControlOverlayState>();
            let payload = state.current();
            if !payload.active {
                break;
            }
            if computer::escape_pressed() {
                emergency_stop(&app, &state);
                break;
            }
            let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) else { break };
            if payload.paused {
                // 暂停期间遮罩不画光标，恢复后需要重新推送当前位置
                last_cursor = None;
            } else if let (Ok(cursor), Ok(origin)) = (overlay.cursor_position(), overlay.inner_position()) {
                let position = (cursor.x - origin.x as f64, cursor.y - origin.y as f64);
                ticks_since_emit += 1;
                if last_cursor != Some(position) || ticks_since_emit >= CURSOR_RESEND_TICKS {
                    last_cursor = Some(position);
                    ticks_since_emit = 0;
                    let _ = overlay.emit(CURSOR_EVENT, CursorPosition { x: position.0, y: position.1 });
                }
            }
        }
        let state = app.state::<ControlOverlayState>();
        state.tracking.store(false, Ordering::SeqCst);
        // 退出期间若遮罩被重新显示，补启一轮，避免光标与 Esc 失去响应
        if state.current().active {
            start_tracking(app.clone());
        }
    });
}

/// 显示遮罩；paused 为 true 时保留状态条但恢复系统光标。相同状态重复调用不产生事件
#[tauri::command]
pub fn show_control_overlay(app: AppHandle, state: State<ControlOverlayState>, paused: bool) -> Result<(), String> {
    let payload = ControlOverlayPayload { active: true, paused };
    if !state.replace(payload.clone()) {
        return Ok(());
    }
    sync_system_cursor(&payload);
    publish(&app, &payload);
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.set_ignore_cursor_events(true);
        let _ = overlay.show();
        let _ = overlay.set_always_on_top(true);
    }
    start_tracking(app);
    Ok(())
}

#[tauri::command]
pub fn hide_control_overlay(app: AppHandle, state: State<ControlOverlayState>) -> Result<(), String> {
    deactivate(&app, &state);
    Ok(())
}

/// 遮罩页面加载时拉取当前状态，避免错过加载前推送的事件
#[tauri::command]
pub fn get_control_overlay_state(state: State<ControlOverlayState>) -> ControlOverlayPayload {
    state.current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_reports_only_real_changes() {
        let state = ControlOverlayState::default();
        let running = ControlOverlayPayload { active: true, paused: false };
        assert!(state.replace(running.clone()));
        assert!(!state.replace(running));
        assert!(state.current().active);
        assert!(state.replace(ControlOverlayPayload { active: true, paused: true }));
        assert!(state.replace(ControlOverlayPayload::default()));
        assert!(!state.current().active);
    }
}
