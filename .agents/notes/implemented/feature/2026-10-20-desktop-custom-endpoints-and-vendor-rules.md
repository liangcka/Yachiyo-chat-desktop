# Agent Note: 桌面网关支持自定义 baseUrl，Key 绑定端点，按厂商套用协议规则

Status: implemented

## Problem

1. **桌面网关忽略 baseUrl**：Web 端早已支持用户填写 OpenAI 兼容端点（火山、Kimi、百炼等厂商卡片都映射到 `openai` 并带默认端点），但桌面网关的请求体没有该字段，所有请求都发往厂商原生端点。桌面端选择这些卡片时，请求实际打到 OpenAI 官方端点，Key 与模型都不对应。
2. **各家 Chat Completions 的思考约定不同**：Kimi K3 拒绝 `thinking`，只认 `reasoning_effort`；千问混合思考模型用 `enable_thinking`；MiniMax 把思考以 `<think>` 标签混在正文里，需要 `reasoning_split`；MiMo 缺少工具轮次的 `reasoning_content` 会返回 400。通用请求体既不能关掉小预算辅助请求里的思考，也无法回传思维链。
3. **直接开放 baseUrl 会泄漏 Key**：桌面端 Key 只存在系统加密存储里，请求不带 `apiKey` 时网关按厂商标识取出。如果请求能指定任意端点，页面里的脚本就可以带着攻击者的 baseUrl 让网关把真实 Key 作为 Bearer 发出去，等于破坏了“真实 Key 不进入页面”的设计。

## Decision

### 自定义端点（Web 与桌面契约一致）

- `ClientChatRequest.baseUrl`：https 起始、无空白、不超过 2048 字符，剥掉尾部斜杠后拼 `/chat/completions`。Claude 与 Gemini 是原生协议，拒绝自定义端点。
- 官方端点专属规则（OpenAI 的 `max_completion_tokens`、`reasoning_effort`、Agent 走 Responses API）只在未自定义端点时生效；自定义端点的 Agent 统一走 Chat Completions，线路协议由 `WireProtocol::resolve` 决定。
- 国内端点（`.cn` 域名或火山、百炼、MiniMax、MiMo、TokenHub、千帆等已知主机）直连优先、代理备用，其余走代理优先、直连备用，与原生厂商的路由规则一致。

### Key 绑定端点

- 加密存储的 `KeyStoreData` 新增 `endpoints`（provider → 保存时的端点，没有记录表示原生端点），旧文件缺少该字段时按原生端点处理。
- `POST /api/keys` 新增可选 `baseUrl`，必须同时提交 Key，因此无法在不知道 Key 的情况下改绑。前端保存和旧版明文 Key 迁移时都带上端点。
- 网关用 `resolve_api_key` 取 Key：请求自带的 Key 优先；否则只有请求的端点（忽略空白与尾部斜杠）与绑定一致才放行，不一致按“未配置 Key”处理。
- 前端：已保存 Key 的卡片改端点时必须重新输入 Key（保存按钮禁用并给出提示），`saveProvider` 也会拒绝用占位符搭配不同端点。多张卡片共用 `openai` 等存储槽时，切换到非所有者卡片不再预填其他卡片的模型、端点，也不能沿用槽内已存的 Key。

### 按厂商套用协议规则

按实际生效端点（自定义 baseUrl，否则为厂商默认端点）的主机后缀识别厂商，再按模型名匹配。规则在 Web（`functions/_shared/providers/compat-vendors.ts`）与桌面（`gateway/providers/compat_vendor.rs`）各实现一份，须保持一致。只处理确认过的型号，未识别的厂商或型号不改动请求。

| 厂商 | 辅助请求（标题、摘要、联网判定） | 聊天 | Agent 思维链回传 |
| ---- | ---- | ---- | ---- |
| Kimi | K2.6 `thinking.disabled`；K3 `reasoning_effort: low` | K3 `reasoning_effort: low` | 每条 assistant 消息都带 `reasoning_content`，缺失补空串 |
| 百炼 | 混合思考型号 `enable_thinking: false` | Qwen3.8 `reasoning_effort: low` | 非空时回传 |
| MiniMax | M3 `reasoning_split` 加 `thinking.disabled`；M3.1 Flash `reasoning_effort: low` | 同左（M3 不关思考） | M3/M2 重建为 `reasoning_details` 数组，M3.1 Flash 回传 `reasoning_content` |
| 小米 MiMo | `thinking.disabled` | 不改动 | 每条 assistant 消息都带 `reasoning_content`（工具轮缺失会 400） |
| 腾讯 TokenHub | hy3、hy4 `thinking.disabled` | hy3 `reasoning_effort: low` | 非空时回传 |
| 百度千帆 | `ernie-5.0-thinking-preview` 的 `enable_thinking: false` | 不改动 | 非空时回传 |
| 智谱 BigModel、Z.ai | 不改动（GLM-5.3 强制思考） | 不改动 | GLM-4.7 起 Agent 请求 `thinking: enabled, clear_thinking: false`，非空时回传 |

型号匹配刻意保守：仅思考的 preview 或早期快照（如 `qwen3.8-max-preview`）传 `enable_thinking: false` 会 400，TokenHub 同时托管强制思考的 GLM-5.3，规则只对混元自家模型生效。

### 流解析

OpenAI 兼容流的解析在两端各增加一个每请求独立的有状态解析器：

- MiniMax `reasoning_details[].text` 有的实现按累计快照下发，有的按增量下发，解析器与已累计文本比对后只输出新增部分；同一 delta 同时带 `reasoning_content` 时以后者为准，避免重复。
- 部分厂商把思考以 `<think>…</think>` 混在正文开头，拆分器只识别正文最开始的思考块，之后的内容原样透传；标签被拆在两个 chunk 之间时暂存半个标签。开头单独出现的 `</think>` 直接丢弃。联网判定的非流式响应同样剥离答案前的思考块。

## Alternatives considered

- **只放行内置厂商主机的 baseUrl**：自定义模型卡片允许填写任意自建中转，白名单会让它们在桌面端失效。
- **自定义端点必须随请求携带明文 Key**：桌面端的 Key 只存在加密存储里，让页面持有明文 Key 会退回到旧版把 Key 放在 IndexedDB 的状态。
- **按 provider 之外再增加独立的存储槽（每张卡片一份 Key）**：需要改动存储结构、迁移与全部卡片逻辑；绑定端点用一张映射表就堵住了泄漏路径，改动面小。
- **对所有 OpenAI 兼容厂商统一关闭辅助请求的思考**：Kimi K3、GLM-5.3、MiniMax M3.1 Flash 等强制思考模型会因此 400，必须按型号区分。
- **厂商规则做成用户可编辑的配置**：属于新的用户可见功能，需要界面与持久化，不在本次范围内。

## Consequences

- 桌面端可以使用火山、Kimi、百炼、MiniMax 等预设卡片和自建中转，思考相关参数按厂商生效。
- 更换已保存 Key 的端点后必须重新输入 Key；旧版本在桌面端保存过自定义端点的配置（当时端点被忽略，请求发往原生端点，本来就不可用）需要重新输入一次 Key。
- 规则依据厂商公开文档与第三方实测整理，上游调整参数约定（例如 Kimi K3 开放 `thinking`、MiniMax 调整 `reasoning_split` 默认值）时需要同步修改两端并更新上表。
- 未收录的厂商仍按通用 OpenAI 兼容请求处理，行为与之前一致。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：全部通过，新增端点绑定（绑定一致才放行、旧文件按原生端点、重启后保持）、`resolve_api_key`、自定义端点请求体、厂商识别与规则、流解析器用例。
- `npm run test:functions`、`npm run test:unit`：全部通过，新增厂商规则、有状态解析器与拆分器、保存和迁移时带端点、改端点需重新输入 Key、共用存储槽的卡片切换用例。
- `npm run typecheck`、`npm run lint`：0 errors。
