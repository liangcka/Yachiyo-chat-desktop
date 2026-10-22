# Agent Note: 深色主题浮层毛玻璃

Status: implemented

## Problem
桌面端设计语言以“中性灰阶、平铺、无毛玻璃”为基线，深色主题下菜单、弹出框与弹窗遮罩均为不透明纯色，浮层与底层内容之间缺少层次感。用户希望夜间模式具备毛玻璃质感，同时保留关闭的能力。

## Decision
- 毛玻璃只作用于浮层与遮罩，主界面（侧栏、顶栏、输入区、消息流）保持纯色平铺：主背景为纯色，在其上做半透明没有可见收益，只会增加合成开销。
- `useTheme` 新增 `glass` 偏好（localStorage 键 `yachiyo-dark-glass`，默认开启，仅显式关闭时写入 `"false"`），并同步到 `document.documentElement.dataset.glass`（`on` / `off`）。设置 → 外观提供“夜间毛玻璃效果”开关。
- `tokens.css` 新增 `--dsw-menu-blur`（默认 `none`），复用既有 `--dsw-mask-blur`。仅在 `[data-theme="dark"][data-glass="on"]` 下：
  - `--dsw-specific-menu` 改为半透明，`--dsw-menu-blur` 设为背景模糊；
  - `--yx-alias-bg-mask` 降低不透明度，`--dsw-mask-blur` 设为轻度模糊。
- 浮层统一以 `background: var(--dsw-specific-menu)` + `backdrop-filter: var(--dsw-menu-blur)` 取材质；遮罩以 `backdrop-filter: var(--dsw-mask-blur)` 取模糊。新增浮层沿用这两个 token 即可自动跟随开关。
- 样式中只写无前缀的 `backdrop-filter`：构建期 lightningcss 会按目标浏览器自动补 `-webkit-` 前缀；若手写 `-webkit-` 版本且排在无前缀之后，lightningcss 会把无前缀声明当作重复项删除，导致 Chromium / WebView2 下完全不生效。

## Alternatives considered
- 主界面面板（侧栏、顶栏、输入区）一并毛玻璃：纯色背景上几乎不可见，且消息流式输出时会持续触发背景重采样。
- Tauri 窗口级 Acrylic / Vibrancy：需改 Rust 与窗口配置，仅 Windows 11 / macOS 生效，Web 与 Linux 无效。
- 不提供开关、深色主题直接生效：用户明确要求可在设置中关闭。

## Consequences
- 浮层打开期间对背后区域做实时模糊，低端设备 GPU 开销略增；关闭开关即恢复原不透明材质。
- `backdrop-filter` 会让元素成为后代 `position: fixed` 的包含块。当前带模糊的元素中，遮罩本身为全屏 `fixed inset: 0`，后代定位不受影响；后续若在带模糊的浮层内放置 `fixed` 子元素，需改用 Portal。
- 浅色主题不受影响。

## Verification
- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`（含设置面板毛玻璃开关用例）
- `npm run build` 后检查产物 CSS 同时包含 `-webkit-backdrop-filter` 与 `backdrop-filter`
- `npm run dev:mock` + Playwright 截图对比开关两种状态：命令面板、模型菜单、设置中心遮罩在开启时背景模糊，关闭时与原不透明样式一致
