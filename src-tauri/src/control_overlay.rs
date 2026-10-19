//! 全屏电脑控制遮罩：显示与隐藏、状态同步、接管横幅的可点击区域。
//! 遮罩窗口默认鼠标穿透，而穿透状态下 webview 收不到任何鼠标事件，横幅无法自行感知悬停；
//! 因此由后端轮询全局光标：进入横幅区域时关闭穿透以便点击接管，离开或合成输入期间恢复穿透。

use crate::computer;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const OVERLAY_LABEL: &str = "control_overlay";
const STATE_EVENT: &str = "control_state_change";
const EMERGENCY_STOP_EVENT: &str = "emergency_stop_control";
const HIT_TEST_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ControlOverlayPayload {
    pub active: bool,
    pub tool_name: String,
    pub detail: String,
}

/// 接管横幅在遮罩窗口客户区内的矩形（物理像素），由遮罩页面按自身布局上报
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct HitRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl HitRegion {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Default)]
pub struct ControlOverlayState {
    payload: Mutex<ControlOverlayPayload>,
    hit_region: Mutex<Option<HitRegion>>,
    hit_testing: AtomicBool,
}

impl ControlOverlayState {
    fn is_active(&self) -> bool {
        self.payload.lock().map(|p| p.active).unwrap_or(false)
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

fn publish(app: &AppHandle, payload: &ControlOverlayPayload) {
    let _ = app.emit_to(OVERLAY_LABEL, STATE_EVENT, payload);
}

fn deactivate(app: &AppHandle, state: &ControlOverlayState) {
    let payload = ControlOverlayPayload::default();
    if state.replace(payload.clone()) {
        publish(app, &payload);
        if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = overlay.hide();
        }
    }
}

fn cursor_over_banner(overlay: &WebviewWindow, state: &ControlOverlayState) -> bool {
    let Some(region) = state.hit_region.lock().ok().and_then(|r| *r) else { return false };
    let (Ok(cursor), Ok(origin)) = (overlay.cursor_position(), overlay.inner_position()) else { return false };
    region.contains(cursor.x - origin.x as f64, cursor.y - origin.y as f64)
}

fn start_hit_testing(app: AppHandle) {
    if app.state::<ControlOverlayState>().hit_testing.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut interactive = false;
        loop {
            tokio::time::sleep(HIT_TEST_INTERVAL).await;
            let state = app.state::<ControlOverlayState>();
            let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) else { break };
            if !state.is_active() {
                break;
            }
            let want = !computer::synthetic_input_active() && cursor_over_banner(&overlay, &state);
            if want != interactive {
                let _ = overlay.set_ignore_cursor_events(!want);
                interactive = want;
            }
        }
        if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = overlay.set_ignore_cursor_events(true);
        }
        let state = app.state::<ControlOverlayState>();
        state.hit_testing.store(false, Ordering::SeqCst);
        // 退出期间若遮罩被重新显示，补启一轮，避免横幅失去点击能力
        if state.is_active() {
            start_hit_testing(app.clone());
        }
    });
}

/// 显示遮罩并同步当前动作；相同状态重复调用不产生事件
#[tauri::command]
pub fn show_control_overlay(
    app: AppHandle,
    state: State<ControlOverlayState>,
    tool_name: String,
    detail: String,
) -> Result<(), String> {
    let payload = ControlOverlayPayload { active: true, tool_name, detail };
    if !state.replace(payload.clone()) {
        return Ok(());
    }
    publish(&app, &payload);
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.set_ignore_cursor_events(true);
        let _ = overlay.show();
        let _ = overlay.set_always_on_top(true);
    }
    start_hit_testing(app);
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
    state.payload.lock().map(|p| p.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn set_overlay_hit_region(state: State<ControlOverlayState>, region: Option<HitRegion>) -> Result<(), String> {
    *state.hit_region.lock().map_err(|e| e.to_string())? = region;
    Ok(())
}

/// 紧急接管：通知主窗口中止当前运行并收起遮罩
#[tauri::command]
pub fn stop_active_control(app: AppHandle, state: State<ControlOverlayState>) -> Result<(), String> {
    let _ = app.emit(EMERGENCY_STOP_EVENT, ());
    deactivate(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_region_uses_half_open_bounds() {
        let region = HitRegion { x: 100.0, y: 20.0, width: 300.0, height: 60.0 };
        assert!(region.contains(100.0, 20.0));
        assert!(region.contains(399.9, 79.9));
        assert!(!region.contains(400.0, 50.0));
        assert!(!region.contains(250.0, 80.0));
        assert!(!region.contains(99.9, 50.0));
    }

    #[test]
    fn replace_reports_only_real_changes() {
        let state = ControlOverlayState::default();
        let payload = ControlOverlayPayload { active: true, tool_name: "click".to_string(), detail: "点击".to_string() };
        assert!(state.replace(payload.clone()));
        assert!(!state.replace(payload));
        assert!(state.is_active());
        assert!(state.replace(ControlOverlayPayload::default()));
        assert!(!state.is_active());
    }
}
