# Agent Note: 桌面控制 look 截图看图与游戏友好的点击注入

Status: implemented

## Problem

桌面控制只能靠 inspect（UI Automation）定位元素。游戏、Scaleform、DirectX 等自绘界面没有可访问元素，模型看不到画面，只能盲点；`screenshot` 只把 BMP 存给用户。另外点击注入时按下与抬起在同一批 SendInput 中送达，且只用 SetCursorPos 移动光标：按帧轮询输入状态、读原始输入的游戏既看不到光标移动，也收不到这次点击。

## Decision

- 新增 `mcp__windows_mcp__look`（默认截前台窗口，`scope: "screen"` 截整个屏幕）。截图按区域平均缩放到长边 1280 以内，编码为 PNG（`png` crate，Cargo.lock 中已存在），记录图像与屏幕区域的换算关系（`computer/vision.rs`）。
- 工具输出以 `<<yachiyo-image:…>>` 标记携带图片。Agent 循环在执行 MCP 工具后拆出图片：工具结果只回填文字（不进工具卡片预览、不触发溢出落盘），本轮工具结果之后追加一条带图用户消息 `attach_screenshot`。之前的截图消息去掉图片、改为说明文字，避免每一轮重复为旧截图计费。Anthropic 请求构造把紧跟工具结果的用户消息并入同一条，保持严格交替。
- `click` 新增 `image_x` / `image_y`：按最近一次 look 的换算关系转成屏幕坐标，模型不需要自己做缩放换算；与 `x` / `y` 二选一，越界或尚未截图时报错。
- 前端按 `supportsImageInput`（与发图判定共用）在请求中带 `agent.vision`，网关只对视觉模型下发 look，非视觉模型拿到截图会直接 400。提示词说明 inspect 找不到元素时改用 look，没有 look 时如实说明看不到画面。
- 点击注入：SetCursorPos 之后再经 SendInput 发一次绝对坐标移动（产生原始输入）；每次点击按下与抬起间隔 50ms，多击之间间隔 60ms。

## Alternatives considered

- 本机 OCR 按文字定位：纯图标、无文字的按钮仍然无法识别。
- 截图直接作为工具结果内容：各家协议对工具结果中的图片支持不一（Chat Completions 的 tool 消息不接受图片），统一走用户消息兼容性最好。
- 每张截图都保留：图片 token 远多于文字，长任务里会迅速放大费用。

## Consequences

- 截图包含控制遮罩绘制的光标与状态条。
- 以管理员权限运行的程序仍会因 UIPI 拒收注入输入（SendInput 返回值可检测到的情形会报错）；全屏独占模式的 DirectX 游戏 BitBlt 可能截到黑屏，需切到窗口或无边框模式。
- look 与其他 MCP 工具一样按写类风险走审批，需确认模式下每次截图都需要批准或选择长期授权。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（缩放、换算、PNG 编码、标记拆分、click 图上坐标、截图只保留最新一张、Anthropic 合并用户消息）
- `cargo check --target x86_64-pc-windows-gnu --lib --tests`（Windows 执行层类型检查）
- `npm run typecheck`、`npm run test:unit`
