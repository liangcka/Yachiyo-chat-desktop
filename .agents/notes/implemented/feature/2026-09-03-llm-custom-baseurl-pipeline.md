# Agent Note: LLM 自定义端点（baseUrl）全链路通道

Status: implemented

## Problem

模型配置面板的供应商选择列表展示 20+ 厂商（火山引擎、阿里云、Kimi、硅基流动、OpenRouter 等）与自定义模型入口，但整条链路存在五处断点，导致实际可用的只有六个原生厂商白名单内的模型：

1. 配置表单采集的 Base URL 在保存时被丢弃（`LlmSettingsRecord` 无对应字段），第三方厂商请求全部发往 OpenAI 官方端点而 401。
2. `saveProvider` 将非白名单模型名静默替换为厂商默认模型，自定义模型名（如 `doubao-pro-32k`）无法保留。
3. `/api/chat` 用户 Key 路径对非白名单模型一律 400。
4. 管理列表硬编码八行展示数据，不反映用户实际配置。
5. 搜索意图判断（judge）固定使用厂商默认端点，用户自带第三方 Key 时凭据会发往错误端点。

## Decision

`baseUrl` 作为可选字段贯穿"UI → Dexie → 请求 → 云函数 → 上游"全链路，带自定义端点的配置跳过模型白名单，无自定义端点的原生厂商路径完全保持现状：

- **领域契约**（`src/domain/llm.ts`）：`LlmSettingsRecord` / `ActiveLlmConfig` 增加 `baseUrl?: string`；新增 `isValidBaseUrl`（https 起始、无空白、≤2048），与后端校验规则镜像对齐。
- **本地存储**（`src/services/llm-settings.ts`）：`baseUrl` 通过 `saveProvider` 的 options 传入，trim 后空串归一为 `undefined`，非法值抛错；存在 `baseUrl` 时跳过模型白名单回退，模型名仅 trim。字段为非索引可选属性，Dexie schema 版本无需升级。
- **请求链路**：`StreamChatRequest` 与聊天控制器的普通聊天/摘要压缩两处请求构造透传 `baseUrl`。
- **云函数校验**（`functions/_shared/validation.ts`）：`allowedTopLevelKeys` 放开 `baseUrl`；仅在 provider 三件套存在时校验其格式。
- **路由**（`functions/api/chat.ts`）：用户 Key 路径下，带 `baseUrl` 时——仅允许 OpenAI 兼容适配器（`provider.isOpenAICompat`，Claude/Gemini 原生协议拒绝）；跳过 `isAllowedModel` 与 `imageModels` 白名单；judge 请求透传 `baseUrl` 与主请求同源，避免第三方 Key 发往默认端点。
- **适配器**（`functions/_shared/providers/openai-compat.ts`）：`resolveEndpoint` 以 `baseUrl` 剥尾部斜杠后拼 `/chat/completions` 覆盖厂商默认端点，主请求与 judge 请求共用。
- **UI**（`src/components/LlmSettingsPanel.tsx`）：保存回调携带 `baseUrl` 并在保存按钮上预校验格式；管理列表改为动态渲染实际配置条目（空态引导提示，自定义端点行带徽标）；编辑回填已存端点。

## Alternatives considered

- **以厂商条目为主键重构存储**（每厂商独立槽位、互不覆盖）：改动面涉及 Dexie schema 升级与后端契约重设计，收益仅是同槽位多配置共存，暂不必要。当前保留六槽位"后配覆盖先配"语义。
- **前端维护厂商→端点映射表替代用户输入**：无法覆盖自建网关与新增厂商，且映射表会持续腐化。
- **对自定义模型名做字符集白名单**：模型命名规范随厂商差异大（含 `/`、`.`、`-`），长度上限（≤64）已足够防御注入。

## Consequences

- 第三方 OpenAI 兼容厂商与自定义模型真正可用，六个原生厂商行为不变。
- 自定义模型的图片输入能力交由上游判定（本地不再拦截），不支持图片的模型由上游报错反馈为 `PROVIDER_ERROR`。
- 错误模型名由上游 4xx 反馈，客户端呈现可重试错误提示；属于用户自配责任范围。
- 桌面端 `/api/keys` 同步通道仅回传 provider 与 key，`baseUrl` 留在本地 Dexie（Rust 侧无需改动）。

## Verification

- `npm run typecheck`
- `npm run lint`（0 错误；2 条既有警告与本次变更无关）
- `npm run test:unit`（266 用例，含 baseUrl 保存/回退/拒绝与面板动态列表新用例）
- `npm run test:functions`（267 用例，含 baseUrl 校验、自定义端点路由转发、judge 同端点、非兼容协议拒绝新用例）
