# Agent Note: 电脑控制重构（进程内原生执行、可接管的系统级遮罩、前端收拢）

Status: implemented

## Problem

桌面 Agent 的电脑控制由三部分组成：内置 `windows_mcp` 服务、前端遮罩、Rust 遮罩命令。三者都有实质缺陷：

1. **内置服务不存在**：`windows_mcp` 配置为 `npx -y @modelcontextprotocol/server-windows`，而 npm 上没有这个包（404）。每次 Agent 运行拉工具清单都会拉起一次注定失败的 npx（失败不缓存），每次工具调用也要先失败一次，才退回 PowerShell 兜底。这给桌面端每条消息平添数秒延迟；非 Windows 平台还会暴露无法执行的工具。
2. **兜底实现与描述不符**：
   - `click` 只移动光标，不点击；
   - `type` 用 SendKeys，`+^%~(){}` 会被当作修饰键；
   - `shortcut` 只映射了 8 个组合，`alt+f4`、`win+d` 会发出错误按键；
   - `app` 把应用名直接拼进 PowerShell 单引号字符串，`focus`/`close` 参数被忽略；
   - `screenshot` 只把文件路径交给模型，模型却以为自己看到了画面；
   - 模型可以向八千代自身窗口注入输入，例如点击权限审批卡片或切换执行模式。
3. **系统级遮罩从未生效**：capability 只覆盖 `main` 窗口，遮罩窗口调用 `plugin:event|listen` 被 ACL 拒绝，收不到任何状态。即使能收到，遮罩处于鼠标穿透时 webview 也收不到悬停事件，靠 `onMouseEnter` 关闭穿透的接管按钮永远点不到；遮罩不持有焦点，Esc 同样无效。
4. **前端重复与抖动**：主窗口内另有一套几乎相同的遮罩组件与样式。`activeControlStep` 每次流式增量都生成新对象，effect 先隐藏再显示，遮罩反复闪烁并刷 IPC。工具判定与文案放在 MCP 增删改服务里。

## Decision

### 进程内原生执行（`src-tauri/src/computer/`）

- 对外沿用 `windows_mcp` 服务 ID 与 `mcp__windows_mcp__*` 工具名，权限键（MCP 工具一律按写入风险走审批）、提示词与前端判定都不变。MCP 面板的开关继续控制启停。
- `McpManager` 对该 ID 不再拉起外部进程：工具清单、连接测试、状态与执行都直接交给 `computer` 模块。非 Windows 平台不暴露工具，状态显示为离线并给出原因。
- `input.rs`（跨平台，单元测试覆盖）：
  - 解析 `ctrl+shift+t`、`win+d`、`alt+f4` 等组合键，方向键、Win 等扩展键带 EXTENDEDKEY 标志；
  - 文本按 UTF-16 码元以 Unicode 方式注入，换行与制表符按真实按键发送。
- `win.rs`（Windows，`cargo check --target x86_64-pc-windows-gnu` 类型检查）：
  - SendInput 注入键鼠，`click` 真正按下与抬起，支持左、中、右键与 1—3 次点击；
  - EnumWindows 列出窗口的标题、进程、位置与大小，`app focus/close` 按进程名或标题匹配，关闭使用 WM_CLOSE；
  - `app launch` 遇到已运行的窗口时切到前台，否则用 ShellExecuteW 启动；
  - GDI 截取整个虚拟桌面，存为 BMP（`bmp.rs` 跨平台编码）。
- 键盘输入在前台是八千代自身时拒绝；点击坐标落在八千代自身窗口（遮罩除外）时拒绝。
- 每个动作后按类型等待片刻（启动 1.5s、切换 0.4s、键鼠 0.15s），再交还给模型。
- 工具说明如实描述能力：截图只保存给用户，定位窗口请用 snapshot；坐标为物理像素。

### 系统级遮罩（`src-tauri/src/control_overlay.rs`）

- 新增 `capabilities/control-overlay.json`，只授予遮罩窗口 `core:event:default`。
- 后端持有当前遮罩状态，相同状态的重复调用不产生事件；遮罩页面加载时通过 `get_control_overlay_state` 拉取一次，补上加载前错过的推送。
- 接管横幅：页面按自身布局上报横幅矩形（物理像素）；遮罩显示期间，后端每 50ms 读取全局光标，进入横幅时关闭穿透，离开时恢复。合成输入期间（`computer::synthetic_input_active`）强制保持穿透，模拟点击不会被横幅吞掉。

### 前端（`src/features/computer-control/`）

- `control-tools.ts`：工具判定、动作文案与 `deriveControlSession`。最近一次工具调用是电脑控制且运行未结束时会话成立，覆盖连续动作之间的思考间隙；等待审批时让出屏幕。
- `use-computer-control-session.ts`：只在动作本身变化时同步遮罩，同时订阅紧急接管事件，并处理主窗口内的 Esc。
- `ControlOverlayWindow.tsx`：取代原 `FullscreenControlOverlayWindow`。删除主窗口内重复的 `ComputerControlOverlay` 及其样式。
- MCP 面板中内置服务的启动命令一栏显示为“内置”。

## Alternatives considered

- **改用第三方 Windows MCP（如 `windows-mcp`、`mcp-control`）**：需要用户另装 Python/Node 运行时，每次调用仍要拉起外部进程；进程内实现没有这些依赖，还能和遮罩共享合成输入状态。
- **继续用 PowerShell 脚本、只修 bug**：每次调用都要启动 PowerShell 并编译 Add-Type，耗时约 1 秒；拼接脚本还有注入面，且无法在本地做类型检查。
- **遮罩用全局快捷键接管**：Esc 会与模型自己发送的 Esc 冲突，可能把运行停掉；其他组合键容易与系统快捷键冲突。改用光标轮询切换穿透，不占用任何按键。
- **截图回传给模型**：需要工具结果支持图片，并在各厂商协议、缩放比例与坐标换算之间做适配，属于独立功能，本次不做。

## Consequences

- 桌面端每次对话不再为内置服务拉起 npx；电脑控制动作在毫秒级完成。
- 遮罩真正可见、可点击接管，连续动作之间不再闪烁。
- 模型无法通过电脑控制操作八千代自身界面；以管理员权限运行的目标窗口会因 UIPI 拦截而返回明确错误。
- Windows 执行层只做过交叉类型检查，没有在 Windows 上运行。坐标与截图依赖应用的 DPI 感知（Tauri 默认按显示器感知），发布前需要在多显示器与高缩放比例下实测。
- 已保存的 `windows_mcp` 配置仍带旧的 npx transport，该字段不再参与运行，无需迁移。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：全部通过，新增组合键与文本规划、参数解析、BMP 编码、遮罩命中区域与状态去重、内置服务不拉起外部进程等用例。
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-gnu --lib`：通过。
- `npm run typecheck`、`npm run lint`：0 errors（唯一的 warning 来自既有的 `ConversationView.tsx`）。
- `npm run test:unit`：全部通过，新增 `control-tools`、`ControlOverlayWindow` 用例；DesktopLayout 用例改为断言系统级遮罩调用与 Esc 接管。
