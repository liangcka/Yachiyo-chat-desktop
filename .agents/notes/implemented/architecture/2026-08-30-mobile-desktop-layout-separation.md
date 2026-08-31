# Agent Note: 手机端与电脑端完全分离解耦架构

Status: implemented

## Problem
在原有的工程结构中，前端界面存在以下多端耦合与体验割裂问题：
1. **单一大组件强耦合**：`App.tsx` 集中承载了全局状态、数据持久化、移动端专用胶水逻辑（Android 返回键 `useAndroidBack`、移动端 `visualViewport` 软键盘动态避让、PWA `UpdatePrompt`）以及移动端单列抽屉弹层 UI。
2. **大屏/桌面端空间浪费与操作冗余**：电脑端运行（Tauri 桌面独立应用或 PC 大屏浏览器）时，依然强制使用移动端的覆盖式全屏抽屉和居中弹层，无法常驻查看会话历史列表，也无法多任务并行查看工作区与 Agent 本地终端。
3. **平台与设备上下文混乱**：移动端专属的视口高度与物理返回键监听直接挂在顶层 `App.tsx`，对桌面端产生不必要的开销与潜在副作用。

## Decision
构建了清晰的三层分离解耦架构：
1. **共享核心层 (Shared Core)**：
   - 提取统一的视图接口契约 `SharedViewProps`（位于 `src/views/layout-types.ts`），严格收口多端共享的数据、控制器与回调动作。
   - `App.tsx` 演进为纯粹的顶层应用控制器与调度器，负责全局上下文、状态生命周期与门禁分发。
2. **响应式设备与平台路由调度器 (`useDeviceMode`)**：
   - 基于 React `useSyncExternalStore` 实现高性能无级联重绘的模式判定。
   - Capacitor Android 原生壳（APK）强制为 `"mobile"`，受保护隔离不被 PC 逻辑干扰；
   - 桌面独立应用（Tauri）与网页浏览器环境均依据 `(min-width: 1024px)` 媒体查询动态自适应视口宽度：宽屏呈现现代三栏工作台，当窗口缩小时平滑回退为针对窄屏/手机尺寸深度优化的紧凑移动端视图，零手动刷新，消除窗口拖拽缩小时的重叠与挤压。
3. **移动端专用视图层 (`MobileLayout`)**：
   - 保留专为手机触控优化的紧凑顶部栏（`TopControls`）、单列对话流、底部操作 Dock（`ControlDock`）与全屏抽屉导航（`MenuDrawer`）。
   - 将 `useAndroidBack`（返回键逐层退出）与 `visualViewport`（软键盘高度适配）严格隔离封装在移动端视图内，彻底不污染桌面环境。
4. **电脑端专属工作台视图层 (`DesktopLayout`)**：
   - 参考 **DeepSeek Harness (DSH)** 现代三栏工作台与 IDE 交互架构；
   - **左侧侧边栏 (`DesktopSidebar`)**：支持 260px 完整模式与 64px 紧凑 Rail 模式一键折叠（支持 `Ctrl+[` 快捷键），完整模式常驻会话列表与 2x2 工具矩阵，紧凑 Rail 模式提供精致垂直图标流与 Tooltip 交互；
   - **中间主对话工作区 (`DesktopChatArea`)**：顶部状态栏（会话标题、状态指示灯、侧边栏展开按钮、快捷拍照、工作区开关），空会话时展示 DSH 风格的精致八千代 Hero 欢迎区与 3 个快捷探索推荐卡片，底部输入框居中优雅自适应（最大宽度 860px）；
   - **右侧多功能工具面板 (`DesktopRightPane`)**：常驻或折叠展示工作区文件树、Agent 终端命令运行与 Git 状态，并支持在右侧直接内联查看与切换 LLM 模型配置、技能、用户记忆，免除弹窗遮挡对话。
   - **桌面全局键盘快捷键**：支持 `Ctrl/Cmd+N`（新建对话）、`Ctrl/Cmd+B`（切换工作区）、`Ctrl/Cmd+[`（折叠/展开侧边栏）、`Esc`（关闭内联侧面板）。
5. **样式系统解耦与舞台宽度解绑**：
   - `desktop.css` 完善了三栏网格、星空毛玻璃工作台面板、Rail 紧凑折叠动效、Hero 探索卡片与快捷键样式，与 `chat.css` 清晰解耦。
   - 桌面端模式下解除 `.chat-stage` 的 430px（`--app-width`）手机固定宽度限制（`.chat-stage--desktop`），自适应占满宽屏空间。

## Alternatives considered
- **仅靠 CSS media query 隐藏与显示元素**：会在 DOM 中重复挂载两套完整组件树，造成状态同步混乱和内存浪费。
- **拆分为两个独立项目构建**：增加代码同步与维护负担，破坏统一的 IndexedDB、LLM 及技能服务生态。最终采用“共享核心 + 多端专属视图层”的最佳实践。

## Consequences
- **收益**：
  - 手机端与电脑端逻辑与视图边界清晰，桌面端拥有现代 IDE 级别的三栏工作台体验，移动端保持轻量紧凑与返回键原生手感。
  - 彻底解耦移动端专属生命周期监听（软键盘、返回键），消除平台副作用。
  - 桌面端与 Web 端在任意窗口尺寸下均能平滑自适应，消除挤压与文字重叠缺陷。
- **代价**：
  - 新增了视图层组件文件，需通过 `SharedViewProps` 维持统一契约接口。

## Verification
- `npm run typecheck`：0 errors（覆盖三份 tsconfig）
- `npm run lint`：0 errors
- `npm run test:unit`：25 测试套件、224 测试用例全量通过（覆盖 DSH Rail 折叠、Hero 探索卡片与桌面端组件测试）
- `npm run test:functions`：22 测试套件、261 测试用例全量通过
- `cargo check --manifest-path src-tauri/Cargo.toml`：0 errors 完成编译检查
