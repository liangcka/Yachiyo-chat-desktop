# 明暗双主题体系与可拖拽列宽机制

## 概述

将 deepseek-harness-master（DSW）的布局骨架与浅色主题体系，同 Yachiyo Chat 的星空玻璃视觉语言融合，形成支持明暗双主题的桌面工作台界面，并引入可拖拽列宽分隔条。

## 主题机制

### 技术选型

- **CSS 作用域**：`[data-theme="dark"]` / `[data-theme="light"]` 属性选择器，挂载于 `document.documentElement`。
- **状态管理**：`useTheme` hook 基于 `useSyncExternalStore`，与项目中 `useDeviceMode` 保持一致的外部存储协议。
- **持久化**：`localStorage` key `"yachiyo-theme"`，支持 `"light" | "dark" | "system"` 三种值。
- **系统跟随**：`theme === "system"` 时监听 `matchMedia("(prefers-color-scheme: dark)")` 的 `change` 事件，清理函数注销监听器。

### Token 体系

- `:root` 保留主题无关 token（motion、radius、layout）。
- `[data-theme="dark"]`：沿用 Yachiyo 深空色阶 `--space-*`、玻璃材质 `--glass*`。
- `[data-theme="light"]`：引入 DSW neutral-bluish 灰阶 + deepseek 品牌蓝 `#4176E6`。
- 新增语义 token：`--interactive-hover`、`--interactive-active`、`--border-l1`/`l2`、`--surface-sidebar`、`--bubble-user-bg`/`--bubble-assistant-bg`、`--focus-ring`。

### 星空画布

- 深色主题挂载 `<StarfieldCanvas />`；浅色主题条件卸载（非隐藏），避免 GPU 空转。
- CSS 层面 `[data-theme="light"] .starfield { display: none; }` 作为兜底。

## 列宽状态生命周期

### 状态

- `sidebarWidth: number`（默认 260px，约束 [200, 400]）
- `detailsWidth: number`（默认 360px，约束 [280, 520]）
- 侧栏折叠态固定 64px，DragHandle 设为 `disabled`。

### 持久化

- localStorage keys：`"yachiyo-sidebar-width"` / `"yachiyo-details-width"`
- 仅在 `onDragEnd` 时写入（非每帧），避免高频 I/O。

### 拖拽实现

- `DragHandle` 组件采用 Pointer Capture + rAF 节流方案（参考 DSW AppFrame）。
- 拖拽期间容器设置 `data-dragging` 属性，CSS 规则 `.desktop-layout[data-dragging] { transition: none; }` 消除过渡抖动。
- `grid-template-columns` 由 inline style 驱动，不再依赖 CSS 中的硬编码值。

### 视觉形态

- 8px 透明热区 + 居中胶囊把手（4px × 32px, border-radius: 10px）。
- 静止时 opacity: 0，悬停或拖拽中 opacity: 1。

## 影响范围

- 不涉及 `src/views/mobile/`、`android/`、`capacitor.config.ts`。
- 所有既有变量名在双主题下均有映射，组件消费侧无需改动类名。
