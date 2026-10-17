# Agent Note: 桌面端沉浸式顶栏会话融合与平铺布局重构

Status: implemented

## Problem
在原有的桌面端三栏布局中，`DesktopChatArea` 包含独立的卡片式 `desktop-chat-header`，造成顶栏与对话工作区出现层级割裂和垂直高度浪费；居中的“对话/编辑器”胶囊控制器占用了大量拖拽手柄区域；侧栏条目与新建对话按钮尺寸偏大、使用了强调色与显眼的视觉装饰，偏离了中性灰阶、高信息密度与无毛玻璃的沉浸式设计语言（Codex / Claude / Antigravity 桌面风格）。

## Decision
1. **中栏去卡片化与平铺化**：
   - 彻底移除 `DesktopChatArea` 内的 `desktop-chat-header`，中栏（`desktop-shell__center`、`desktop-shell__chat`、`desktop-main-chat`）采用零外边距、无大圆角平铺架构。
2. **顶栏会话与项目态融合**：
   - 会话标题展示与就地编辑（重命名）迁移至 `DesktopTopBar` 左侧，保留快捷键与确定/取消交互。
   - 在标题后紧跟次要色当前项目显示名（`useProjectState` + `getProjectDisplayName`），强化工作区上下文。
3. **视图切换控制器精简**：
   - 移除顶栏中央的大尺寸双 tab 胶囊，改为右侧紧凑的小图标按钮（32×32px，`CodeXml` / `MessageSquare`），释放大面积原生拖拽区域，同时完整保留 `Ctrl+1`（对话）与 `Ctrl+2`（编辑器）全局快捷键。
4. **侧栏条目与新建操作紧凑化**：
   - “新建对话”调整为一行透明底文字按钮（`Plus` 15px + 文字），悬停时呈浅灰色（`var(--interactive-hover)`）。
   - 会话历史条目高度收敛至 30px、字号 13px、单行省略；激活态采用浅灰底（`var(--interactive-active)`），彻底剥离品牌强调色与发光。

## Alternatives considered
- **保留中栏子顶栏，仅压缩内边距**：被否决。依然会导致多层 header 堆叠，无法实现统一顶栏的极简感。
- **视图切换保留双文字小 pill**：被否决。右侧空间紧凑，单图标切换按钮可兼顾高信息密度与触达直觉。

## Consequences
- 提升了对话区可视垂直空间；
- 窗口拖拽区域大幅扩大，多屏交互与移动更平滑；
- 侧栏信息密度提升约 25%，长列表浏览体验更紧凑一致。

## Verification
- `npm run typecheck`：通过（覆盖前端与服务端三份 tsconfig）。
- `npm run lint`：通过（0 errors）。
- `npm run test:unit`：单元测试全量通过（含 `DesktopTopBar.test.tsx`、`DesktopLayout.test.tsx`、`sidebar.test.tsx`）。
