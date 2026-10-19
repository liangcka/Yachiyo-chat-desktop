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

## 后续迭代（实测反馈：点击不准、无反馈、agent 卡死，遮罩不美观）

首轮在 Windows 实测（GLM-5.3-Flash 让八千代给 QQ 联系人发表情包）暴露的问题与处理：

### 点击准确性与实时反馈（根因修复）

模型看不到截图，只能凭窗口位置猜坐标点击搜索框、联系人、表情按钮，几乎必然点偏；为了"看清"界面，它转而用 `run_command` 跑一长串 `Add-Type -AssemblyName UIAutomationClient …` 的 PowerShell 脚本去读界面文本，该脚本耗时长、输出大，最终把 agent 拖到卡死停摆。

- 新增 `mcp__windows_mcp__inspect`（`src-tauri/src/computer/uia.rs`）：用 UI Automation 枚举前台窗口的可点击元素（按钮、编辑框、链接、列表项、菜单项、标签页等），每个给出类型、名称与中心坐标（优先 `get_clickable_point`，否则包围盒中心）。模型据此拿到真实坐标再点，不再估算。依赖 `uiautomation` crate（COM 多线程模型，跑在 `spawn_blocking` 线程）。
- `click` 在点击前用 `element_from_point` 识别目标元素，把"实际点中的元素名"随结果回传（`已在 (x,y) 左键单击 → 按钮「表情」`），形成"inspect 看坐标 → click → 反馈核对"的闭环；点错可立即重新 inspect。
- `snapshot` 末尾、`inspect`/`click` 的工具说明、以及 Agent 提示词都明确：点击窗口内元素前必须先 inspect，禁止用 run_command 跑 PowerShell UIAutomation 读界面。这同时消除了 agent 卡死的根因。
- 前台是八千代自身窗口时 inspect 拒绝；全自绘、未暴露无障碍信息的窗口返回可读提示，引导改用 screenshot 或请彩叶描述。

### 遮罩重构（单行、蓝色、独立光标）

- 状态条简化为一行「八千代正在控制你的电脑」+ 接管按钮，去掉原来的双行动作详情。
- 主题色由紫色（`139,92,246`/`168,85,247`）改为蓝色（`59,130,246`/`96,165,250`）；接管按钮保留红色（停止语义）。
- 新增类似 Codex 的独立光标：后端在遮罩轮询循环里顺带把全局光标位置（遮罩客户区物理像素）通过 `control_cursor_move` 推给遮罩，遮罩渲染一个蓝色发光环直接跟随，光标移动只改 DOM 样式不触发 React 重渲染。

### 验证（补充）

- `cargo check --target x86_64-pc-windows-gnu --lib`：通过（含 `uiautomation`）。
- `cargo test`、`npm run test:unit`（含更新后的 `ControlOverlayWindow` 单行+光标用例）、`npm run test:functions`、`typecheck`、`lint`：全部通过。
- UI Automation 的运行时行为（各类应用能否枚举到元素、坐标准确度）仍只在 Windows 实测验证，未在本环境运行。

## 第三轮迭代（隐藏系统鼠标、状态条贯穿整个运行、Esc 取消、agent 中途停止）

实测反馈：agent 做到一半停止；遮罩在两步之间闪断；控制时屏幕上同时有系统鼠标和八千代光标；状态条仍不美观，接管按钮多余。

### agent 中途停止

根因是 `AgentLoopConfig` 默认 `max_turns` 为 12：一次"打开应用 → inspect → 点击 → 核对 → 输入 → 发送"的桌面任务每步一轮，12 轮不够，循环以 `MaxTurnsReached` 结束，表现为最后一轮工具已执行但 agent 不再继续。默认值改为 `DEFAULT_MAX_TURNS = 50`。

### 状态条贯穿整个运行

- `deriveControlSession` 由"最近一次工具调用是控制动作"改为"本次运行的助手消息里执行过控制动作"，运行结束才收起。中途的 inspect、snapshot、读文件与模型思考不再让遮罩闪断。
- 等待审批时不再收起遮罩，而是进入 `paused`：状态条保留，系统光标恢复，彩叶可以正常点击审批卡片。
- 遮罩状态收敛为 `{ active, paused }`，去掉不再展示的动作详情 `toolName`/`detail`。

### 隐藏系统鼠标

- `active && !paused` 时用 `SetSystemCursor` 把 13 种系统光标逐个替换为 32x32 空白光标（`SetSystemCursor` 会接管并销毁句柄，每个 ID 单独创建）；其余状态用 `SystemParametersInfoW(SPI_SETCURSORS)` 重载用户的光标方案。`CURSOR_HIDDEN` 原子标志保证重复调用无副作用。
- 兜底：应用 `RunEvent::Exit` 时恢复；启动时无条件重载一次，覆盖上次在控制中途被强制结束、系统光标停留在空白的情况。
- 遮罩绘制箭头形状的八千代光标，尖端对准后端推送的真实光标位置；`paused` 时不绘制。

### Esc 取消与状态条样式

- 遮罩全程鼠标穿透、拿不到焦点，删除横幅命中区域与穿透切换（`set_overlay_hit_region`）以及接管按钮（`stop_active_control`）。
- 后端在遮罩轮询循环（30ms）里用 `GetAsyncKeyState(VK_ESCAPE)` 检测物理 Esc，命中即广播 `emergency_stop_control` 并收起遮罩；合成输入期间（`synthetic_input_active`）不计，避免模型自己发送的 Esc 把运行停掉。主窗口有焦点时另有 keydown 兜底。
- 状态条改为纯浅蓝底（`#60a5fa`）白字单行：「八千代正在控制你的电脑 | 按 Esc 取消控制」；屏幕四周保留同色 2px 细边框，去掉发光脉冲与四角折角。

### 取舍

- 曾考虑只在遮罩上画光标、不隐藏系统光标：两个指针同时出现，正是本轮反馈的问题。
- 曾考虑用 `ShowCursor(FALSE)`：它只影响调用线程所属的窗口，对其他应用无效，只能替换系统光标。
- 曾考虑注册全局快捷键：会吞掉其他应用的 Esc；轮询只读取按键状态，不影响 Esc 在目标应用中的原有作用。

### 验证（第三轮）

- `cargo test`、`cargo check --target x86_64-pc-windows-gnu --lib`、`npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run test:functions`：见提交记录。
- 光标替换与恢复、全局 Esc 检测仍需在 Windows 上实测（含多显示器、高缩放比例）。
