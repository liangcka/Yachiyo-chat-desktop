# Agent Note: 自定义端点拉取模型列表

Status: implemented

## Problem

「自定义模型 (OpenAI Compatible)」表单没有任何可选模型，只能手动输入模型名；服务商卡片有预设列表，自定义端点却没有。用户不知道端点提供哪些模型，容易填错。编辑已保存的自定义配置时，端点匹配不到任何服务商卡片，表单还会落到第一张同厂商卡片（火山引擎），标题与预设都对不上。

## Decision

- 自定义表单的模型名输入框旁提供「获取模型列表」按钮，请求端点的 OpenAI 兼容 `GET {baseUrl}/models`，取 `data[].id` 去重排序后渲染为可点选的标签（区域限高滚动），点选即填入模型名；失败或为空时给出提示，仍可手动填写。
- 桌面端经网关 `POST /api/models`（`{ baseUrl, key?, slot? }` → `{ models }`，错误体为 `{ error: { code } }`）代理：webview 直连第三方端点受 CORS 限制，且已保存的 Key 只在网关内。未填新 Key 时按 `slot`（配置 id）取已存 Key，取用经 `get_key_for_endpoint` 校验端点，Key 只会发往保存时绑定的端点。线路选择沿用 `select_clients`，连接层失败时换客户端重试一次。
- 网页端由浏览器直连 `{baseUrl}/models`；端点不允许跨域时提示失败，用户手动填写。
- 编辑配置时，带 `baseUrl` 且匹配不到服务商卡片的配置按自定义表单打开。

## Alternatives considered

- 在 Pages Functions 增加模型列表代理：让边缘函数按用户给的任意 URL 发请求，扩大 SSRF 面，收益只覆盖网页端少数不允许跨域的端点。
- 使用 `<datalist>`：WebKitGTK 等 webview 对其支持不一致，且无法展示数量与失败提示。

## Consequences

- 只适配 OpenAI 兼容的 `/models` 结构；非标准端点返回空列表，表单提示手动填写。
- 列表只在当前表单内有效，不持久化，每次打开表单需重新获取。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml server::http`（含 `models_endpoint_strips_trailing_slash`、`parse_model_ids_sorts_dedups_and_skips_invalid`）
- `npm run test:unit`（含 `model-list.test.ts`、`LlmSettingsPanel.test.tsx`）
- `npm run typecheck`、`npm run lint`
