# Agent Note: 新建对话空会话幂等与防繁殖重构

- **生命周期 (Lifecycle)**: implemented
- **分类 (Class)**: refactoring
- **日期 (Date)**: 2026-09-04
- **主题 (Topic)**: prevent-blank-chat-proliferation

---

## 1. 背景与问题定义

在原先的聊天控制器实现中，`newConversation()` 无论当前活跃会话状态如何，均无条件调用 `repository.createConversation()` 并向本地存储（Dexie IndexedDB）写入新的会话记录。

此逻辑导致了以下严重缺陷：
1. **空会话连续新建繁殖**：用户刚打开应用处于空白会话时，连续点击“新建对话”、快捷键 `Ctrl+N` 或在下拉菜单中切换工作区，每次均生成一整排标题为“新的对话”的空记录；
2. **切回有消息会话后无法复用草稿**：用户新建空白会话但未发言，切回历史会话后再次新建，系统并未复用先前的未发言空会话，而是再次创建新会话，导致死会话堆积并很快触发 30 段本地会话上限；
3. **输入与交互连击**：快捷键长按未阻止 `e.repeat` 重复派发，异步 `handleNewChat` 缺少并发锁。

---

## 2. 核心决策与架构设计

为了实现与现代主流客户端（ChatGPT、Claude、Trae、Cursor）一致的干净交互体验，制定了多层防繁殖契约：

### 2.1 空会话幂等复用 (Idempotent on Blank Chat)
在 `useChatController` 的 `newConversation()` 中：
- 当当前活跃会话存在且 `messages.length === 0`，且存储中确认无历史消息与进行中的流式生成时：
- **不调用 `createConversation`**；
- 直接复用当前会话，仅清空输入框与草稿，不向数据库写入多余空壳。

### 2.2 优先复用已有未发言空白会话 (Reuse Existing Blank Chat)
当用户从有消息的活跃会话触发新建对话时：
- 先检索会话列表；
- 若已存在未发送任何消息且标题为默认标题（“新的对话”/“新しい会話”）的空白会话，直接调用 `selectConversation` 切换复用，不重复生成；
- 仅当所有会话均包含有效消息时，才创建全新会话。
- 保证整个系统中未发送消息的空会话数量至多为 1。

### 2.3 历史孤儿空会话自愈清理 (Self-Healing Pruning)
在控制器初始化以及复用已有空白会话时，若检测到因历史缺陷残留了多个无消息默认空会话，后台异步清理多余孤儿空壳，保留最新 1 个，帮助用户自愈已有污染。

### 2.4 交互层防重与防连击
- `DesktopLayout.tsx`：`Ctrl+N` 快捷键增加 `if (e.repeat) return;`；
- `App.tsx`：`handleNewChat` 增加 `creatingChatRef` 互斥锁。

---

## 3. 验证与门禁覆盖

1. **类型检查**：`npm run typecheck` 覆盖三份 tsconfig（app、node、functions），零错误；
2. **单元测试**：
   - `src/app/use-chat-controller.test.tsx`：新增空会话调用 `newConversation` 幂等不创建单测、已有空白会话优先复用单测；
   - `src/components/app-flows.test.tsx`：更新 CRUD 与上限测试用例，新增空会话连续点击新建不繁殖专项测试；
   - 全量 285 个前端单元测试 100% 通过；
3. **服务端测试**：`npm run test:functions` 267 个测试 100% 通过；
4. **全量构建**：`npm run build` 打包顺利完成。
