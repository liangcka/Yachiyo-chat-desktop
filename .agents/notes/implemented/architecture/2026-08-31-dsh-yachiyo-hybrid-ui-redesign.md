# Agent Note: dsh 布局框架 × Yachiyo 星空玻璃 UI 融合重造

Status: implemented

## Problem

此前的 UI 在三方面与成熟设计语言存在差距，导致视觉与交互体验不统一：

1. **视觉 token 缺少语义分层**：组件样式直接引用 `--space-*`、`--glass*` 等底层静态 token，语义（背景层级、边框层级、文字层级、交互态）与具体色值耦合，浅色主题下部分面板（历史、技能、用户记忆）沿用硬编码深蓝底色无适配。
2. **消息与输入形态陈旧**：用户/助手消息均为居中气泡形态，输入区为贴底窄条，缺乏 dsh（DeepSeek Harness Web）那种「用户右对齐气泡 + 助手通栏 + 浮动胶囊输入卡」的现代对话形态。
3. **布局细节不完整**：PC 三栏虽已存在，但缺少窄视口自动退化（rail 折叠）、侧边栏 footer 系统操作区等 dsh shell 细节；全局滚动条、动效曲线等基线未统一。

## Decision

以 **dsh 的布局与交互框架** 结合 **Yachiyo 星空玻璃视觉基因** 完成纯 UI 层重造，业务逻辑层（controller、数据、服务、云函数）零改动：

1. **三层语义 token 体系**（`src/styles/tokens.css`）：
   - 在既有 `--space-*` / `--glass*` 静态层之上新增 dsh 式语义层：`--yx-alias-*`（bg-layer-1/2/3、bg-overlay、bg-mask、border-l1~l4、label-primary/secondary/tertiary、interactive-bg-hover/active/hover-accent、button-primary/floating、markdown-code-block、scrollbar、state-error、shadow-floating）与 `--yx-specific-*`（bubble-user/assistant、input-major、sidebar-fill、sidebar-nav-item-hover/active）。
   - 明暗双主题完整映射；组件样式一律消费语义 token，禁止新硬编码色值。
   - 新增大圆角语言 `--yx-radius-lg: 22px`（气泡/输入卡/浮层）、动效基线 `0.2s var(--motion-ease-smooth)`（cubic-bezier(0.4,0,0.2,1)）；全局滚动条 token 化（`global.css`）。
2. **PC 三栏 shell**（`DesktopLayout`）：保留列宽拖拽与 localStorage 持久化、快捷键（Ctrl/Cmd+N/B/[、Esc）、拖拽期禁过渡；新增 `window.innerWidth` resize 监听，视口 < 900px 时显示层强制 64px rail 折叠（不写用户偏好），恢复宽视口还原。
3. **侧边栏**（`DesktopSidebar`）：dsh SidebarRoot 式结构——品牌行（折叠按钮）→ 品牌底新会话按钮（22px 圆角）→ 会话历史滚动列表（hover/active 走 `--yx-specific-sidebar-nav-item-*`）→ 底部系统操作区（快捷工具、主题、语言、压缩、清除、退出）；rail 态纯图标流 + title 提示。
4. **消息形态**（`chat.css` 消息段）：用户消息右对齐 22px 圆角气泡（限宽 78%，移动端 86%，图片内切圆角）；助手消息通栏全宽、无气泡底（仅 hover/选中态落极淡底）；typing 指示为紧凑淡底胶囊；上下文菜单走玻璃浮层 token。
5. **输入区**（`Composer`）：重造为浮动胶囊卡——22px 圆角、`--yx-specific-input-major` 底、`--yx-alias-shadow-floating` 浮动阴影、focus-within 焦点环；action row 左侧附件按钮（新增，`i18n` key `attachImage` 双语）、右侧发送/停止切换；图片预览条迁入卡内。PC 端由 `DesktopChatArea` 的 composer dock 提供渐隐遮罩与 820px 居中限宽，移动端由 `chat-bottom` 输入坞承载。
6. **移动端**：确认与 Yachiyo chat 原版模式同源（TopControls + 单栏对话流 + 输入坞 + 全套抽屉面板 + `useAndroidBack` 逐层关闭），顶栏/工具坞/输入坞样式统一 token 化并补齐上边缘渐隐遮罩。
7. **面板与全局组件**：MenuDrawer、HistoryPanel、LlmSettingsPanel、SkillsPanel、UserMemoryPanel、AccessGate、ToastRegion、ToolCard、WorkspacePanel 等全部接入语义 token；主操作按钮统一 `button-primary-fill` 语言；浅色主题首次获得完整面板适配。

## Alternatives considered

- **整体切换为 dsh 的 neutral-bluish 设计语言**：会丢失 Yachiyo 星空玻璃品牌视觉与 StarfieldCanvas 基因，被否决——仅借鉴其布局框架与形态语言，配色仍锚定星空体系。
- **两套主题可切换（星空 / dsh 中性）**：维护成本翻倍且语义 token 层已可表达两套肤色的差异，无必要。
- **仅重造 PC 端**：移动端与新消息形态/输入卡会形成两端体验割裂，故同步统一。
- **消息形态维持双气泡**：助手信息密度高的回复（工具卡、来源链接、代码块）在气泡内展示效果差，通栏更适合。

## Consequences

- **收益**：视觉语义与色值解耦（换肤只动 alias 映射）；消息/输入形态对齐主流 AI 对话产品；浅色主题面板首次完整适配；动效与滚动条全局一致。
- **代价**：token 总量增加（静态 → alias → specific 三层，换肤心智成本略升）；`--yx-*` 与既有 `--glass*`/`--surface-*` 并存，后续新增组件应优先消费 alias/specific 层。
- **注意**：参考项目 `D:\程序\web\deepseek-harness-master` 与 `D:\程序\web\Yachiyo chat` 全程只读，未做任何修改。

## Verification

- `npm run typecheck`：0 errors（tsconfig.app / tsconfig.node / functions 三份）
- `npm run lint`：0 errors（仅 1 条既有 TanStack Virtual 库兼容性 warning，非本次引入）
- `npm run test:unit`：25 个测试文件、224 个用例全量通过（含 DesktopLayout 6 项、app-flows 18 项、chat-components 17 项，测试断言零修改即全绿）
