# Agent Note: 桌面网关长回复被拦腰切断

Status: implemented

## Problem

桌面 Agent 运行常在工具步骤之后「莫名其妙中断」，消息以失败结束。网关上游客户端用 `reqwest::ClientBuilder::timeout(120s)` 构建，这个时限覆盖从建连到读完整个响应体的全过程：推理模型的一次流式回复（长思考加长输出，或高峰期排队）超过两分钟就被强制断开，循环报 `上游流读取失败` 并以 `PROVIDER_STREAM_ERROR` 结束。上游偶发的 429/5xx 与建连失败也会直接让整个运行失败。

## Decision

- `server/http.rs` 的 `gateway_client_builder()` 只设 `connect_timeout(20s)` 与 `read_timeout(180s)`（两次读取之间的空闲上限），不再设总时限。
- `HttpTurnExecutor` 单轮最多尝试 3 次（间隔 1.5s、3s），只在尚未向前端输出任何内容时重试：建连失败、408/429/500/502/503/504/529，以及首个事件之前流就中断。已经下发过思考或正文的轮次不重放，避免界面出现重复内容。

## Alternatives considered

- 把总时限调大到 10 分钟：仍会切断更长的回复，而且卡死的连接要等很久才失败。
- 输出过半后也重试并让前端去重：需要给事件加序号与回滚协议，改动面大。

## Consequences

- 上游真正卡死时要 180 秒无数据才失败；前端的 45 秒空闲超时由网关每 5 秒的心跳维持，不受影响。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`
