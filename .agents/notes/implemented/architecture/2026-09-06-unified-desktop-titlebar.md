# 2026-09-06 沉浸式一体化桌面顶栏架构 (Unified Desktop Title Bar)

## 背景与问题陈述
在桌面端窗口原生呈现中，系统标题栏与前端顶栏呈双层分裂状态：
1. **上层**：Windows 操作系统原生灰色标题栏（高约 32px），包含标题 `Yachiyo Chat` 及系统默认的最小化、最大化、关闭按钮。
2. **下层**：应用内顶栏，左侧为侧栏品牌行，右侧为视图控制器（`对话 Ctrl+1` / `编剧室 Ctrl+2`）。

该布局侵占了工作区宝贵的垂直视口空间，且风格割裂不一体。

## 核心架构设计

### 1. 窗口无边框沉浸模式 (Frameless Window)
- 在 `src-tauri/tauri.conf.json` 中配置 `decorations: false`，消除操作系统默认的原生标题栏。
- 维持 `resizable: true`，借助 Windows DWM 特性保留四边调整手柄与外阴影。
- 在 `src-tauri/capabilities/default.json` 中补齐 `core:window:allow-*` 权限，同时在 `src-tauri/src/lib.rs` 暴露原生的 `minimize_window`、`toggle_maximize_window`、`is_window_maximized` Rust 命令。

### 2. 一体化现代顶栏组件 (`DesktopTopBar`)
在 `src/views/desktop/DesktopTopBar.tsx` 构建单行（高度 38px）顶层组件：
- **左区**：微型品牌徽标（`月见八千代` + `IDE` 胶囊）及侧栏折叠开关（`Ctrl+[`）。
- **中区**：深海蓝胶囊视图控制器（`对话 Ctrl+1` ↔ `编剧室 Ctrl+2`）。
- **拖拽区**：中间及非交互空白区域通过 `data-tauri-drag-region` 声明窗口移动手柄，并支持双击在最大化与还原之间平滑切换。
- **右区**：原生质感桌面窗口控件组（最小化、最大化/还原动态图标、关闭红底高亮）。在网页模式下自动优雅隐藏。

### 3. 主布局联动
- `DesktopLayout.tsx` 挂载 `DesktopTopBar`，包裹在 `desktop-shell-root` 容器内。
- 侧边栏通过 `hideBrandHeader={true}` 避免品牌与折叠开关垂直重复。
- 中栏移除重复的分段切换器，让聊天区与编辑器区顶部对齐，视野更加通透专注。
