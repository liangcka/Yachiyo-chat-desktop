# Agent Note: 清理移动端遗留代码并收紧桌面端 CSP

Status: implemented

## Problem

移动版界面移除后，菜单抽屉、历史面板、旧输入框、访问码页、星空画布等组件与对应 Hook 仍留在 `src/`，只被各自的测试引用；`chat.css` 与 `desktop.css` 中约 1000 行规则只服务于这些组件。桌面端 `tauri.conf.json` 的 `csp` 为 `null`，发布版仍启用 `devtools` 特性；`relay_client.rs` 已无调用却仍引入 `tokio-tungstenite`。设置中心及其面板随主包首屏加载。

## Decision

- 删除无引用的组件（`MenuDrawer`、`HistoryPanel`、`TopControls`、`ControlDock`、`Composer`、`AccessGate`、`StarfieldCanvas`、`drawer/*`、`SidebarBrandHeader`）、`use-panel`、`use-android-back` 及只覆盖这些组件的测试用例。
- 以 PostCSS 解析样式表，删除所含类名在源码中不存在的选择器；类名按全文出现过的词判断，模板插值前缀、函数伪类（`:not()` 等）内的类名与 Monaco 外部类名一律视为存活，宁可多留不误删。
- Tauri 配置显式 CSP：脚本仅 `'self'`；样式允许内联（React 行内样式与 Monaco 动态注入），并以 `dangerousDisableAssetCspModification: ["style-src"]` 避免 Tauri 追加 nonce 后使 `'unsafe-inline'` 失效；`connect-src` 仅放行 IPC 与本机网关；Worker 允许 `'self'` 与 `blob:`。
- 移除 `tauri` 的 `devtools` 特性（调试构建仍自带开发者工具），删除 `relay_client.rs` 与 `tokio-tungstenite`。
- 设置中心改为 `React.lazy` 按需加载，主包从约 722KB 降到约 649KB（未压缩）。
- `use-chat-controller.ts` 中的纯函数拆为 `stream-batcher.ts`、`request-history.ts`、`conversation-compression.ts`，Hook 主体保持原逻辑。

## Alternatives considered

- 只删除组件、保留样式：死样式会在后续改版时持续制造误判。
- CSP 中保留 `'unsafe-eval'`（与 Web 端 `_headers` 一致）：构建产物不含 `eval`/`new Function`，无需放开。
- 继续把 `use-chat-controller` 的状态流程拆成多个子 Hook：涉及大量共享 ref 与时序，回归风险高于收益，本次只拆出无状态部分。

## Consequences

- `relay-worker/` 子项目已无桌面端客户端，如不再计划远程中继可整体删除。
- 新增外部资源（远程图片、第三方脚本、外部 API 直连）时需同步更新 `tauri.conf.json` 的 CSP。

## Verification

- 清理前后对主界面、窄窗口侧栏、右侧面板、编辑器、MCP 与模型设置、用户菜单、添加菜单做 A/B 截图，像素差仅出现在有意修改的顶栏品牌标志区域。
- 以相同 CSP 在 Chromium 中加载构建产物并操作对话、设置与编辑器，无 CSP 拦截；Monaco 模块 Worker 可正常启动。
- `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run test:functions`、`cargo test`、`npx playwright test`（32 通过、6 个按项目条件跳过）全部通过；`cargo check --target x86_64-pc-windows-gnu` 通过。
