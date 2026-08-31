# Agent Note: 新对话空白状态居中对话框布局实现

Status: implemented

## Problem

在桌面端/Web 视口下，新创建的对话（isBlank === true，无历史消息）呈现中央 Hero 欢迎区域（包含“月见八千代”大标题、副标题与 4 个功能引导卡片），而输入对话框被固定在视口最底部。这种割裂的布局导致用户在开始新会话时视线与交互焦点分散，与主流现代 AI 对话产品（如 Claude、ChatGPT、DeepSeek）的中央聚焦体验不一致。

## Decision

对桌面端主工作台 (DesktopChatArea.tsx) 及样式 (desktop.css) 进行外科手术式重构：

1. **结构与状态解耦**：
   - 提取输入交互卡片逻辑为同一套渲染节点（包含工作区 Chip、附件预览、输入文本框、模型选择器、上下文指示器、快捷指令 / 及发送/停止按钮）。
   - 当 isBlank === true 时：将输入卡片置于 .desktop-hero 容器内（位于欢迎大标题/副标题下方、4 个快捷引导卡片上方），页面底部不再渲染 Dock。
   - 当 isBlank === false（发送首条消息或切换至有记录会话）时：输入卡片平滑切换至底部 .desktop-composer-dock 模式，主体区域展示 ConversationView 消息流。
2. **样式精修**（src/styles/desktop.css）：
   - 新增 .desktop-hero__composer 容器类，定义 max-width: var(--dsh-composer-card-max-width)（800px），与下方的 .desktop-hero__cards 保持统一的对齐线与边距；
   - 调整 .desktop-hero__subtitle 间距（margin: 0 0 20px;），使标题、居中输入框、引导卡片在视口中呈现黄金垂直比例；
   - 居中容器支持响应式滚动，在小高度视口下自然溢出滚动，在充裕高度下完美垂直水平居中。

## Consequences

- **收益**：新对话进入时视觉焦点集中在屏幕中央，引导卡片与输入框浑然一体；首条消息发送后自然转入消息流滚动和底部 Dock 模式。
- **兼容性**：移动端与窄屏行为保持既有隔离与稳定；桌面端所有键盘快捷键（Enter、Ctrl+B、Ctrl+N 等）、附件上传与模型切换体验 100% 保持一致。

## Verification

- 
pm run typecheck：通过（覆盖前端、node 及 functions 配置）
- 
pm run lint：通过（0 error）
- 
pm run test:unit：25 个测试文件、227 个测试用例全量通过（包含新增的新对话居中与底部 Dock 切换断言）
- 
pm run test:functions：22 个测试文件、261 个测试用例全量通过
