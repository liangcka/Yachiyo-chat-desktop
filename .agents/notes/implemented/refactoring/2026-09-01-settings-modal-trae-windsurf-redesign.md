# Agent Note: 设置中心（SettingsModal）现代化重构 — Trae 与 Windsurf 深度融合

Status: implemented

## Problem

此前设置弹窗存在以下结构与视觉不足：
1. 缺少独立的账户管理与隐私控制面板（如 Trae 的账号信息、Lite 会员订阅状态、隐私数据保护开关与退出登录）；
2. 常规面板缺乏智能体与权限卡片体系（如 Windsurf 的排队消息分段控制、安全预设策略、产物审核策略、文件/网络/终端权限及 MCP 工具规则）；
3. 左侧侧边栏结构单一，缺少项目树（Projects）与未在项目中分组、快捷键入口、反馈入口与底部用户信息栏；
4. 缺少分段选择器（Segmented Control）、下拉选择器与开关（Toggle Switch）的现代化精细样式支持。

## Decision

对设置中心（SettingsModal.tsx 与 desktop.css）及二级菜单（SkillsPanel、UserMemoryPanel）进行全面现代化重构：

1. 新增【账号】（Account）管理面板（图 1 Trae 风格）：账户信息卡片、会员订阅卡片、隐私模式 Toggle 开关（持久化存储）与退出登录。
2. 升级【常规】（General）面板（图 2 Windsurf 风格）：排队消息分段选择、安全预设下拉框、产物审核策略下拉框、文件与网络访问权限规则、终端命令与 MCP 工具权限卡片。
3. 重塑左侧侧边栏导航：常规分类、项目分组列表、未在项目中对话、底部快捷键与反馈外链、底部用户信息卡片（点击直达账号页）。
4. 样式与视觉设计对齐：采用设计系统语义 token，深浅双主题无缝适配，补充 Segmented Control、Dropdown、Toggle Switch、Count Badge 等现代化样式。
5. 消除二级弹窗堆叠与子菜单嵌入式重构（Secondary Menu & Embedded Panels）：
   - 为 `SkillsPanel` 和 `UserMemoryPanel` 引入 `embedded` 模式与现代卡片视觉体系，消除旧版在 `SettingsModal` 或侧边栏内部弹出二次遮罩浮层的问题；
   - 在【自定义】Tab 嵌入八千代长期记忆编辑卡片与技能扩展开关（支持 Prompt 展开预览与 `settings-toggle-switch`）；
   - 在【浏览器】Tab 专一嵌入联网检索管道与来源引用开关；
   - 桌面端右侧面板（DesktopRightPane）同样启用 `embedded` 模式渲染，使全工作区视觉与交互严密统一。

## Verification

- npm run typecheck：覆盖 app、node、functions 3 份 tsconfig，0 errors
- npm run lint：0 errors
- npm run test:unit：31 个测试套件、282 个用例全量通过
- 交互测试：设置中心各 tab 切换流畅无二次模态遮罩覆盖。
