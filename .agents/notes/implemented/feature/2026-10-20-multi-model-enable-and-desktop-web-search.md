# Agent Note: 多模型同时启用与桌面 Agent web_search 工具

Status: implemented

## Problem

1. 模型管理表格的开关语义是“设为当前使用”，同一时刻只能有一个开关处于开启状态，无法让多个已配置模型同时出现在聊天区的模型选择器中。
2. 角色提示词把 `web_search` 写成常备工具，但桌面 Agent 的原生工具集只有 `web_fetch`，模型调用 `web_search` 得到 `Unknown tool`，表现为“web_search 工具不可用”。

## Decision

1. `LlmSettingsRecord` 新增可选字段 `disabled`（缺省视为启用，旧数据无需迁移）。`LlmSettingsService.setEnabled` 切换启用状态：停用当前使用的厂商时切到最近更新的另一家已启用厂商，没有则清空激活指针；启用时若无激活厂商则直接设为当前。设置页开关表示“启用”，当前使用的模型额外显示“当前使用”标签；聊天区 `ModelSelect` 与命令面板只列出已启用模型。保存配置会重建记录，因此重新保存即重新启用。
2. `src-tauri/src/tools/web.rs` 新增 `web_search`：请求必应 RSS（免 Key），按查询文字推断市场（假名→ja-JP，汉字→zh-CN，其余→en-US），本地市场无结果时退到 en-US。工具风险等级为只读。`run_agent_chat_stream` 仅在请求带 `webSearch: true` 时下发该工具，`build_agent_system_prompt` 按开关追加“已开启 / 已关闭”说明，关闭时引导模型提醒用户打开开关而不是报告工具故障。

## Alternatives considered

- 用 settings 表单独存一份启用列表：需要与记录增删保持同步，不如挂在记录上的可选字段简单。
- 无视联网开关始终下发 `web_search`：会让“联网搜索”开关在桌面端失去意义。
- 移植云端完整搜索管道（多源合并、正文抓取）到 Rust：体量大，Agent 可自行组合 `web_search` + `web_fetch` 达到相近效果。

## Consequences

- 必应 RSS 无鉴权，可能被限流或返回空结果；失败时工具返回明确错误，模型可换关键词重试。
- `build_agent_system_prompt` 签名增加 `web_search` 参数。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`、`npm run lint`、`npm run test:unit`
