# Agent Note: 桌面端本地网关 token 鉴权与工具执行授权边界

Status: implemented

## Problem

桌面端进程启动时会 spawn 一个 Axum 本地 HTTP 网关（`src-tauri/src/server/http.rs`），绑定 `127.0.0.1`，端口在 28888 起的可用区间浮动，对外提供 `/api/chat`（SSE）、`/api/agent/approval`、`/api/keys`、`/api/mcp/*` 等路由。改造前这些路由不含任何调用方校验，且以 `CorsLayer::new().allow_origin(Any).allow_headers(Any)` 全量放行跨域，构成本机可达的无凭据能力面：

- 浏览器把回环地址视为可信源，页面访问 `http://127.0.0.1:*` 不触发混合内容拦截；`Allow-Origin: *` 又让 Preflight 通过并使响应体可读。于是用户浏览的任意公网页面都能直接驱动本地网关。
- 由此形成两条完整利用链：其一，POST `/api/chat` 让 Agent 调 `run_command`，从 SSE 流里读出 `requestId` 后自行 POST `/api/agent/approval` 放行，等价于远程执行宿主命令；其二，POST `/api/mcp/servers` 写入恶意 stdio 配置（`command` + `args`），待下一次 spawn 即执行。`/api/keys` 还会泄露已配置厂商并覆写 API Key。
- 工具执行侧缺少显式授权契约：`execute_tool_with_context` 的参数里不含「谁批准了这次执行」，SSE Agent 路径的审批只活在调用循环内部，IPC 命令 `execute_agent_tool` 则接受任意工具名且不经过风险判定。
- `web_fetch` 以字节上限截断后直接用 `text[..max_len]` 切片，切点落在多字节字符中间即 panic，抓取 CJK 页面必然命中；`run_command` 的高危拦截是 9 条针对原始小写字面串的 `contains` 黑名单，`rm -fr /`、`Remove-Item -Recurse -Force C:\`、`-EncodedCommand` 等常见变体全部旁通。

## Decision

1. **启动期随机 token 与 `/api/*` 门禁**
   - `generate_gateway_token()` 在 `run()` 构建 `DesktopState` 之前同步生成 32 字节随机数的 hex 串（复用既有 `rand` 依赖，写法对齐 `crypto/keys.rs` 的 `fill_bytes`），随进程生命周期不变，不入磁盘。
   - token 同时持有于 `DesktopState.gateway_token` 与 `server::http::AppState.token`，通过新增 IPC 命令 `get_gateway_token` 交给 webview。
   - `create_router` 以 `middleware::from_fn_with_state(state, require_gateway_token).route_layer(...)` 只包裹已注册的 `/api/*` 路由；静态资源走 `fallback_service`，不受 token 约束，否则页面本身无法加载。校验读取请求头 `x-yachiyo-gateway-token`，与 token 做恒定时间比较（`constant_time_eq` 逐字节异或累积；`==` 会在首个相异字节短路，可被时延差测出前缀），不匹配即在 SSE 流开始之前返回 `401 {"error": ...}`。
   - 前端在 `src/services/api-origins.ts` 的 `apiFetch` 单点注入该头，覆盖全部 10 个 `/api` 调用点：桌面判定就地内联（`app-platform` 依赖 `api-origins`，反向 import 会形成模块环），`@tauri-apps/api/core` 用动态 import，token 取到后模块级缓存、取失败缓存空串不再重复 invoke。Web/PWA 与 APK 轨道走同步分支、不新增任何请求或告警，自动换线逻辑不变。
2. **CORS 收敛为显式源清单**：`AllowOrigin::list` 放行 `http://127.0.0.1:<实际端口>`、`http://localhost:<实际端口>`（按 `state.port` 动态构造）、`http://127.0.0.1:5173`、`http://localhost:5173`（vite dev proxy 会透传 Origin）、`http://tauri.localhost`、`tauri://localhost`；`allow_headers` 收敛为 `content-type` 与 token 头。`handle_session` 保留本机 BYOK 无配额语义，只是从此受 token 保护。
3. **授权契约类型化**：`tools::ToolAuthorization`（`HumanInitiated` / `ModelInitiated { approved }`）成为 `execute_tool_with_context` 与 `execute_tool` 的必填入参。`tool_risk` 判为 `Write` 的工具在 `ModelInitiated { approved: false }` 时于执行边界直接返回错误、不落地任何副作用。Agent 循环把审批结果原样封装为 `ModelInitiated { approved }` 下发；循环内的门禁保留（它负责回给模型的拒绝话术与 `session_scope` 记忆），执行边界成为独立的第二道权威。IPC 的 `execute_agent_tool` 以 `HumanInitiated` 下发，并受 `IPC_TOOL_WHITELIST` 约束，只放行 `read_file`、`write_file`、`git_status`、`git_diff`、`run_command`。
4. **高危命令检测改为形态检测**：先归一化（小写、剥离引号字符、把 shell/PowerShell 结构标点视作分隔符、折叠空白），再按「删除动词 + 递归标志 + 根或关键系统路径目标」「内容重写指向盘根」「磁盘与主机电平破坏」「编码与间接执行」四族判定，覆盖 `rm -fr /`、`rm -r -f /`、`rm --recursive --force /`、`Remove-Item -Recurse C:\`、`rd /s /q C:\Windows\System32`、`Format-Volume`、`Stop-Computer`、`-EncodedCommand`/`-enc`/`-e`、`Invoke-Expression`/`iex`、`certutil -decode`、`FromBase64String` 等形态，同时放行 `npm install`、`cargo test`、`git status`、`nvidia-smi --format=csv`、`dotnet format`、`rm -rf node_modules` 等日常用法。无工作区时回退用户主目录执行的既定行为不变。
5. **输出截断与子进程回收**：`tools::floor_char_boundary` 提升为 `pub(crate)`，`web_fetch` 复用它计算切点（不改动 16KB 语义，也不与 `truncate_tool_output` 的 32KB 上限混用）；`run_command` 设置 `kill_on_drop(true)`，使超时丢弃 wait future 时子进程随之被杀，不再留下挂活进程。

## Alternatives considered

- **按 Origin/Referer 判定合法性**：本机非浏览器进程可不带这些头，且头部内容可伪造，无法作为凭据；随机 token 才是不可猜测的共享秘密。
- **Cookie 或 HTTP Basic**：需要引入登录态或凭据存储，而桌面端本来就是本机自用，一次性进程内 token 已足够且无持久化泄露面。
- **每请求一次 IPC 取 token**：为 10 个调用点重复跨边界调用；模块级缓存一次即可，token 不随请求轮转。
- **给 IPC 的 `write_file`/`run_command` 也弹审批**：IPC 路径的这三个入口正是编辑器保存、diff 应用与终端面板手敲命令，全部是人类主动发起的动作，强制弹窗只会退化成噪音；IPC 的纵深防御改由工具名白名单承担。
- **无工作区时禁用 `run_command`**：与「支持 Agent 无工作区通用执行」的既定设计冲突，前端文案也依赖该回退语义。
- **真沙箱（容器 / Job Object / 低权限用户）**：能给出权威边界，但代价是引入平台强相关的重量级实现与安装前置，超出当前阶段；先以显式授权契约 + 形态检测收敛风险面。
- **让执行边界成为唯一门禁、删掉循环内 `if approved`**：模型会收到通用拒绝文案而非既有的「不要重试同一动作」引导，且 MCP 分支不经过 `execute_tool_with_context`，删除后反而出现空档。

## Consequences

- 桌面端与网关之间新增一条隐式协议：header 名 `x-yachiyo-gateway-token` 由 `src-tauri/src/server/http.rs` 的 `GATEWAY_TOKEN_HEADER` 与 `src/services/api-origins.ts` 的 `gatewayTokenHeader` 两处字面量共同约定，改名必须同步，否则全量 401。`allowed_origins` 的源清单同理：新增前端宿主（例如别的 dev 端口或别的 webview 协议源）必须显式补录。
- token 只在同一 webview 进程内流转，因此只有桌面端能调用 `/api/*`；任何绕过 `apiFetch` 自行 `fetch` 的新代码都拿不到凭据，必须走 `apiFetch` 或显式注入。
- `execute_tool_with_context` / `execute_tool` 签名变更，新增工具接入点必须回答「这次执行由谁授权」，无法再默认放行。
- 高危命令检测明确定位为**纵深防御、非权威边界**：命令串最终仍由 `powershell -Command` / `sh -c` 解释，字符串形态检测理论上可被变量展开等方式绕开，权威边界始终是 Write 类工具的用户审批链。
- 未一并变更的既有事实：Tauri 自带 CSP 仍为 `null`（`src-tauri/tauri.conf.json`），webview 内脚本注入仍是 IPC 白名单要防的主要前提；`handle_session` 的 `remaining: 9999` 是本机桩值而非真实配额；`functions/` 云函数轨道不受本次改动影响。

## Verification

- `cargo build --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：70 个用例全量通过。其中 `test_local_gateway_token_gate_and_cors_allowlist` 以真实 HTTP 往返验证「无 token 与错 token 均 401、带 token 放行、静态资源不受门禁、非白名单源拿不到 ACAO 而 dev 源被回显」；`test_dangerous_command_variants_blocked` 与 `test_develop_commands_not_blocked` 分别锁定变体拦截与日常命令放行；`test_write_tool_requires_approval_at_execution_boundary` 断言未获批的写类工具在执行边界被拒且不留任何落盘副作用；`http.rs` 内的 token 形态、恒定时间比较与允许源清单测试锁定鉴权契约。
- `npm run typecheck`：覆盖 app、node、functions 三份 tsconfig，0 errors。
- `npm run lint`：0 errors（仅存量 1 条 `react-hooks/incompatible-library` warning）。
- `npm run test:unit`：44 个测试套件，377 个用例全量通过（`api-origins.test.ts` 等对 `apiFetch` 入参的精确断言在非桌面环境下不受影响）。
