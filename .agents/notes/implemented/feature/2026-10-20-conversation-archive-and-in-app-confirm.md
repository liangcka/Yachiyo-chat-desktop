# Agent Note: 对话归档、会话操作菜单与应用内确认弹窗

Status: implemented

## Problem

- 侧栏只能删除对话，不能把暂时不看的对话收起来。
- 删除确认用 `window.confirm`，桌面端弹出标题为「tauri.localhost 显示」的原生对话框，与应用风格割裂，并且会阻塞页面事件循环（后台对话的流式渲染也停住）。
- 每个条目悬停时挤着置顶、重命名、删除三个小图标。
- 标题栏窗口控件使用原生 `title` 提示；窗口是透明无边框的，WebView2 的原生气泡贴着窗口右缘会被裁切并留下黑边残影。

## Decision

- `Conversation.archivedAt` 为可选字段（无需索引与版本迁移），`ConversationRepository.setConversationArchived` 写入或删除该字段。侧栏把已归档对话收进列表下方默认折叠的「已归档」分组；归档当前对话后切到最近的未归档对话；启动时打开最近的未归档对话，全部归档则新建；新建对话复用空白会话时跳过已归档的。
- 条目悬停只显示一个「⋯」按钮，菜单含置顶、重命名、归档/取消归档、删除。菜单通过 portal 挂到 body 并按按钮位置固定定位，避免被侧栏滚动容器裁切，空间不足时向上展开，滚动或缩放时自动收起。
- 新增 `ConfirmDialog` 组件替代 `window.confirm`（会话删除、MCP 服务删除）。破坏性操作默认聚焦「取消」，Esc 取消；删除运行中的对话会提示同时停止运行。
- 窗口控件改用 `data-tooltip` 驱动的页面内提示，右对齐到按钮内侧。

## Alternatives considered

- 归档状态像置顶一样存在 localStorage：清除站点数据会丢失，且启动选择会话时拿不到。
- 菜单做成条目内的绝对定位：最后几个条目的菜单会被滚动容器裁切。

## Consequences

- 置顶仍存在 localStorage，归档存在 IndexedDB，两者独立；已归档对话的菜单不显示置顶。

## Verification

- `npm run test:unit`（侧栏归档分组、菜单操作、应用内删除确认、App 删除流程与标题栏窗口控件用例）
