# Agent Note: 桌面安装包分发链路

Status: implemented

## Problem

桌面端只在 `tauri dev` 下可用：前端以相对路径请求 `/api/*`，开发时依赖 Vite 代理转发到 28888；打包后页面源为 `tauri.localhost`（Windows）或 `tauri://localhost`，相对请求到不了 Axum 网关。网关端口在 28888 被占用时会顺延，但前端无从得知。此外桌面端也注册了 PWA Service Worker，升级安装包后可能继续返回旧缓存；仓库没有发布工作流，用户只能自行编译；`public/live2d` 中约 98MB 的第三方模型虽未被引用，仍会随 `dist` 打进安装包。

## Decision

- `apiFetch` 在桌面运行时通过 IPC 并发取得 `get_server_port` 与 `get_gateway_token`，以 `http://127.0.0.1:{port}` 直连网关并附带 token 头；成功结果缓存，失败不缓存，下一次请求重试。Web 与 APK 轨道保持原有同源与换线逻辑。
- Tauri `setup` 中同步完成网关端口绑定后再进入事件循环，保证前端首次 IPC 读到的是实际端口。网关 CORS 白名单已包含 `http://tauri.localhost`、`tauri://localhost` 与开发服务器源。
- 桌面端不注册 Service Worker：`usePwaUpdate` 在模块加载时按运行环境选定实现；启动时与 APK 一样清理残留的 Service Worker 与 Cache Storage。
- 新增 `check_for_update` 命令，读取 GitHub Releases 最新正式版与当前包版本；前端 `update-check` 负责版本比较，启动时静默检查一次，有新版本时在右下角提示并打开下载页。网络失败不提示。
- 新增 `Release` 工作流：推送 `v*` 标签后在 Windows 上用 `tauri-action` 构建 NSIS 与 MSI 安装包并创建草稿 Release。CI 新增 Windows 上的 `cargo test` 任务。
- 删除 `public/live2d` 与历史手机截图；`package-lock.json` 的 `resolved` 统一指向 `registry.npmjs.org`，配置了镜像源的用户仍会按 npm 的 `replace-registry-host` 规则走镜像。

## Alternatives considered

- 让主窗口直接加载 `http://127.0.0.1:{port}` 由网关托管静态资源：需改动窗口 URL 与 IPC 来源校验，且端口在运行时才确定，配置层无法表达。
- 引入 `tauri-plugin-updater` 做静默增量更新：需要生成并保管更新签名私钥并配置到仓库 Secrets，当前维护方式下先采用“检查并跳转下载”的低依赖方案。
- 在 Rust 侧异步绑定端口并让 `get_server_port` 等待就绪：需要额外的同步原语，而同步绑定只耗时数毫秒。

## Consequences

- 发布版桌面端可直接对话；开发态同样走绝对地址，不再依赖 Vite 代理端口与网关端口一致。
- 安装包未签名，首次运行会出现 SmartScreen 提示；购买证书后在 `bundle.windows` 配置签名即可。
- 发布需同步修改 `package.json`、`tauri.conf.json`、`Cargo.toml` 三处版本号（见 CONTRIBUTING）。

## Verification

- `npm run typecheck`、`npm run lint`（零错误，保留虚拟列表已有警告）。
- `npm run test:unit`：新增桌面网关地址与 token 头、版本比较用例，全部通过。
- `npm run test:functions`、`cargo test --manifest-path src-tauri/Cargo.toml` 全部通过。
- `npm ci` 使用官方源从改写后的 lockfile 完成安装，完整性校验通过。
