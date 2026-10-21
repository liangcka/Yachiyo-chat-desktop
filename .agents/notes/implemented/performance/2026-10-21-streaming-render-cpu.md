# Agent Note: 流式输出与输入期间的渲染 CPU 优化

Status: implemented

## Problem

空闲时主线程几乎为零，CPU 集中在流式输出与输入期间。用 CDP Performance 指标在约 40 条历史消息的会话中测得：流式输出主线程占用 35%~38%（JS 14%~15%），连续打字约 12%。profile 与 trace 显示四个来源：

1. 流式批处理跟随显示器刷新率刷新，每帧整段重渲 Markdown 并重新布局、绘制，高刷屏上成倍放大。
2. 每次流式增量都调用平滑 `scrollIntoView`：每帧重启平滑滚动动画，并沿祖先链强制布局，是 profile 中最大的 JS 热点。
3. `ConversationView` 每次渲染都为每条消息新建 `versions` 数组与 `onEdit`/`onRegenerate`/`onVersionChange` 闭包，`MessageBubble` 的 memo 全部失效；输入框的值提升在上层，每次按键也会重渲全部气泡。
4. 侧栏运行指示点动画 `box-shadow`，无法交给合成器，只要有会话在运行（包括后台的长时间 Agent 任务）就逐帧重绘。

## Decision

- `stream-batcher` 两次刷新至少间隔 32ms（约 30 帧/秒），间隔未到时先 `setTimeout` 再对齐到下一帧；`flush` 同时取消两种排程。
- 流式增量的跟随滚动改为直接设置滚动容器 `scrollTop = scrollHeight`；新消息仍用平滑 `scrollIntoView`，减少动效偏好下同样直接定位。
- `MessageBubble` 的编辑、重新生成、切换版本回调改为携带消息 id，`ConversationView` 直接传入上层的稳定引用；`versions` 只在多版本时传数组（气泡本就只在多版本时显示切换器）。
- 运行指示点的呼吸只动 `opacity`，扩散光环改为 `::after` 的 `transform` + `opacity` 动画。
- 桌面控制遮罩的光标跟踪在光标静止时不再每 30ms 推送，保留约 0.5 秒一次的保底重发，覆盖遮罩订阅晚于首个坐标的竞态。

## Alternatives considered

- 引入完整的 Markdown 增量解析：改动面大，节流后整段重渲的开销已可接受。
- 自定义 `memo` 比较函数忽略回调引用：会留下过期闭包隐患，回调携带 id 更直接。
- 降低流式刷新到 15~20 帧/秒：CPU 更低但文字增长出现可感知的顿挫。

## Consequences

- 同一测量条件下流式输出主线程占用降到 22%~24%（JS 6%~8%），打字降到约 9%；无头浏览器为 60Hz，高刷屏上收益更大。
- 流式文字最多比到达时晚约 32ms 上屏。
- `MessageBubble` 的三个回调签名变化，新增调用方需传入接收消息 id 的函数。

## Verification

- `npm run test:unit`（含新增 `stream-batcher.test.ts`、更新后的滚动跟随测试）
- `npm run typecheck`、`npm run lint`
- `cargo build --manifest-path src-tauri/Cargo.toml`
