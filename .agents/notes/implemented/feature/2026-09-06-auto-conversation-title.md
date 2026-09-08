# Agent Note: 对话完成自动提炼标题与会话名称同步自愈

- **生命周期 (Lifecycle)**: implemented
- **分类 (Class)**: feature
- **日期 (Date)**: 2026-09-06
- **主题 (Topic)**: auto-conversation-title

---

## 1. 背景与问题定义

用户在使用桌面端与 Web 端对话时发现，完成一次对话（用户输入“这是什么这个项目”，助手回复完成）后，顶栏标题和侧边栏历史会话列表依然显示为“新的对话”。历史列表中多个包含消息的既有会话也同样保持在“新的对话”未被命名。

经代码排查，根本原因如下：
1. **缺失标题提炼与自动更名触发点**：`useChatController` 的 `finishRun` 在流式运行结束时仅负责消息持久化与状态派发，未对默认标题（“新的对话”/“新しい会話”）的会话生成与持久化标题。
2. **状态机与控制器契约缺陷**：`chat-reducer` 缺少 `conversation-renamed` action，`ChatController` 也未暴露 `renameConversation` 方法，导致无论自动命名还是手动改名，React 活跃会话对象（`state.activeConversation.title`）均无法即时同步。
3. **顶层侧边栏缺少变更通知**：`App.tsx` 的 `conversations` 列表与控制器生命周期完全解耦，消息完成或元数据修改时无法自发刷新。
4. **历史孤儿标题未自愈**：用户数据库中先前已产生的多个带消息但标题仍为“新的对话”的记录，打开或切换时缺乏自愈修复逻辑。

---

## 2. 核心架构与决策

### 2.1 确定性零消耗标题提炼模块 (`conversation-title.ts`)
避免在每次新会话结束时发起第二次 LLM 接口调用（额外消耗用户每日配额、增加 2-3 秒网络延迟、面临角色扮演语气污染或离线失败风险）。
采用确定性启发式提炼流水线：
- 定位首条用户消息 (`role === "user"`)；
- 剥离 Markdown 代码块（```` ```...``` ````）、HTML 标签与内联标记；
- 若输入纯代码块，兜底为“代码分析”；若仅上传图片，兜底为“图片分析”；
- 剥离问候语与通用前缀（如“请问”、“你好”、“八千代，”等）；
- 剥离句末标点符号（“？”、“。”、“！”等）；
- 严格限制在 20 个 Unicode 字符以内，超出添加省略号，保证侧边栏与顶栏视觉整洁。

### 2.2 状态机支持 `conversation-renamed`
在 `src/app/chat-reducer.ts` 中新增 `conversation-renamed` action，当 `activeConversation.id === action.conversationId` 时直接更新其 `title`，确保 Header 渲染与控制器内部状态强一致。

### 2.3 控制器集成自动命名与手动重命名
在 `src/app/use-chat-controller.ts` 中：
1. **完成对话触发**：在 `finishRun`（流式运行结束，特别是 `status === "complete"` 时），检测到会话标题仍为默认标题且已产生消息时，自动提炼标题、存入数据库、派发 `conversation-renamed` 并调用 `onConversationUpdated`。
2. **统一对外暴露 `renameConversation`**：提供与 IndexedDB 同步并派发状态的统一封装，供 `DesktopChatArea` 和侧边栏编辑直接调用。
3. **全链路自愈机制**：
   - 首次加载或切换会话（`selectConversation`）时，若会话有消息且标题仍为默认标题，即时补全标题；
   - 启动后台自愈任务遍历已有会话，修复历史残留的“新的对话”会话记录。

### 2.4 顶层列表强一致刷新 (`App.tsx`)
向 `useChatController` 注入 `onConversationUpdated` 回调，在会话标题生成、重命名或自愈后自动触发 `refreshHistory()`，保证侧边栏历史列表实时同步。

### 2.5 大模型智能语义提炼模式 (`mode: "title"`) 与两阶平滑命名
在启发式命名零延迟生效的基础上，满足用户“让AI自己自定义对话标题”的深度诉求：
1. **服务端双端对齐支持专用 `mode: "title"`**：
   - **云函数（Cloudflare Pages Functions）与桌面端（Tauri Rust Gateway）全对齐**：
     - `src-tauri` 中的 `RequestMode` 枚举扩展 `Title`，支持 Axum HTTP `/api/chat` 反序列化；
     - `src-tauri/src/gateway/prompt.rs` 增加专用中日双语提示词（`TITLE_PROMPT_ZH` / `TITLE_PROMPT_JA`）；
     - 各桌面端 Provider（OpenAI-Compat, Anthropic, Gemini）设置对应的 `max_tokens`（512/128/512）与 50 字符流截断；
   - **配额豁免与轻量路由**：云端 `mode === "title"` 请求自动跳过用户每日会话额度校验（`consumeDailyQuota`），且跳过联网搜索与历史总结等重型前置，保证毫秒级启动与极低开销；
2. **前端双阶平滑升级流水线与防复读提示词**：
   - **第一阶（0 延迟保底）**：首轮流式结束立即采用启发式提取标题入库并更新 UI，杜绝等待与滞留；
   - **第二阶（后台异步提炼）**：随后在后台静默请求大模型提炼标题，传入包含助手完整回复的消息列表。Prompt 显式要求“概括讨论的核心事物或主题，不要直接照抄用户的提问原话”；完成后经过清洗（优先提取《》与双引号、剥离前缀与客套话）无缝替换启发式标题；
   - 若会话先前已落定为启发式标题，后续轮次依然能平滑升级至大模型语义标题，若用户已手动输入重命名则保持锁定；
3. **交互扩展**：
   - 桌面端顶栏标题编辑区新增“✨ AI 提炼标题”按钮，支持用户随时对长会话发起一键智能概括。
4. **无条件自动开启 (`autoAiTitle: true`)**：
   - `useChatController` 内部与 `App.tsx` 确保生产与桌面端默认开启全自动 AI 标题提炼（无需用户手动点击任何按钮）；
   - 彻底修复 `autoAiTitleRef` 默认值与两阶竞争判断，在首轮以及多轮对话完成后均可全自动触发大模型智能提炼并平滑替换启发式标题；
   - 包含完整的控制台 Trace 调试日志，透明反映候选检查、Prompt 提炼与最终标题替换过程。

---

## 3. 验证覆盖

1. **服务端请求与 Prompt 校验**：
   - `functions-tests/_shared/validation.test.ts`：覆盖 `mode: "title"` 参数校验放行；
   - `functions-tests/_shared/prompt.test.ts`：覆盖标题专用 Prompt 构造与双语适配；
   - `functions-tests/api/chat.test.ts`：验证 `mode: "title"` 免扣除每日额度与 Mock 流式返回；
2. **前端标题清洗与请求构造**：
   - `src/app/conversation-title.test.ts`：覆盖首提问启发式提取、AI 标题正则清洗（过滤书名号、标点、前缀等）与双语 Prompt 构造；
3. **控制器端到端验证**：
   - `src/app/use-chat-controller.test.tsx`：覆盖首问启发式立即落定、后台异步 AI 标题升级、已改名会话不覆盖、手动调用 `generateAiTitle`；
4. **桌面端 UI 交互**：
   - `src/views/desktop/DesktopLayout.test.tsx`：验证顶栏 AI 提炼标题按钮渲染与交互触发；
5. **全量门禁**：
   - `npm run typecheck`（三份 tsconfig 0 错误）；
   - `npm run lint`（0 错误）；
   - `npm run test:unit`（38 测试套件，350 测试用例全部通过）；
   - `npm run test:functions`（22 测试套件，271 测试用例全部通过）；
   - `npm run build`（前端产物构建成功）。
