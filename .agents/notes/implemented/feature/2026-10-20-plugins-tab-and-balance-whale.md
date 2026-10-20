# Agent Note: 设置「插件」页与余额小鲸鱼

Status: implemented

## Problem

用户希望在 Yachiyo 中完整使用 DeepSeek-Balance-Whale-Widget（窗口角落显示 DeepSeek 余额的鲸鱼娘挂件），外观与交互与原版一致，并在设置里单独提供插件开关。上游是 DeepSeek Harness 的宿主插件：约 2.2 万行原生 JS 前端（`assets/whale-widget.js`）通过 25 个 `/dsh-whale/*` 接口访问 Node 宿主，宿主读写 `$DSH_HOME` 下的配置、账本、图片与音频。本项目的网页版（Cloudflare Pages）与桌面网关都没有这些路由，也没有可供挂件写入的服务端文件系统。上游 `PROVENANCE.md` 声明美术素材不在 MIT 范围内、不授予再许可。

## Decision

- **前端原样内置**：`src/features/whale-widget/upstream/whale-widget.js` 是 npm 包 `dsh-whale-widget@0.4.2` 中的前端脚本，逐字节未改，附上游 MIT 许可证。经 Vite `?url` 作为独立资源输出，仅在插件启用时以经典 `<script>` 注入（脚本依赖非模块语义）；ESLint 忽略该目录，PWA 预缓存排除该文件。
- **宿主在页面内实现**：`host/whale-host.ts` 移植上游宿主中与 Yachiyo 相关的路由，`runtime.ts` 在首次启用时接管两条通道，其余请求原样放行：
  - `window.fetch` 中同源 `/dsh-whale/*` 交给宿主返回 `Response`；
  - `HTMLImageElement.prototype.src` 遇到 `/dsh-whale/*` 地址时先经宿主取出图片，再换成同源 Blob URL 赋值（期间不加载，取不到则赋空串触发 error）。同源图片才能让挂件读像素做命中检测与透明区穿透。
- **数据存放**：上游的 `.dshw-*.json` 改为独立 IndexedDB 库 `yachiyo-whale-widget`（`docs` 表存 JSON 文档、`blobs` 表存自定义角色、泡泡图与音频片段）。JSON 文档启动时整体读入内存，路由内的读改写同步完成，写回按调用顺序排队。
- **记账**：`host/accounting.ts` 移植上游记账内核（1e-8 定点金额、按「账户 + 币种」分本、余额上升单独记录并支持余额校正、逐轮明细保留 90 天或 2 万条、逐日汇总 365 天）。`host/peak.ts` 移植峰谷规则（工作日 9–12、14–18 点高峰，周末与法定节假日全天谷价）。
- **余额**：经两端同名的 `POST /api/deepseek/balance` 获取：网页版传浏览器本地的 Key 并以其 SHA-256 前 24 位作为账户标识；桌面端不传 Key，由网关只取绑定原生端点的已存 Key。只认绑定官方端点的 DeepSeek Key。25 秒缓存、请求去重、瞬时失败沿用最近余额并标记 `stale`。
- **每轮消耗**：Yachiyo 的 usage 不含缓存命中 token，无法按上游的 token 单价精确换算，因此改为回复开始时记下余额、结束 2.5 秒后强制刷新，以余额下降额作为本轮消耗，写入 `last-turn.json` 序号（持久化，避免刷新后被挂件当成旧轮次）与按模型的用量明细。
- **等待提示**：Agent 工具审批（`pendingPermission`）映射为上游的「授权提示」，对话名来自当前会话标题；Yachiyo 没有提问工具，提问提示不会触发。
- **不可用的上游能力**：多厂商余额模板、凭据服务、Codex 本机会话统计依赖 DSH 宿主能力。`api-models.json` 只返回内置 DeepSeek，新增或修改其它厂商模型、写入 Key 时返回明确的不支持说明；「关于」面板如实标注宿主为 Yachiyo 内置。
- **素材**：图片与音效不入库，运行时从 `https://cdn.jsdelivr.net/npm/dsh-whale-widget@<版本>/assets/` 加载，版本与内置脚本绑定（`assets.ts` 的 `WHALE_WIDGET_VERSION`），浏览器 HTTP 缓存版本化地址。离线时对应路由返回 404，挂件按上游逻辑静默降级。网页与桌面 CSP 放行 `connect-src https://cdn.jsdelivr.net`（素材经 fetch 取回后转为 Blob）与 `https://data.jsdelivr.com`（「关于」面板检查上游新版本）。
- **设置**：「插件」页只保留总开关、未配置 DeepSeek Key 时的引导与原项目链接；挂件自身的外观、音效、泡泡、提醒等设置都在挂件菜单内。插件设置存 localStorage（`yachiyo-plugin-settings`），经同页事件即时生效。脚本无法卸载，关闭插件或离开桌面布局时为 `<html>` 加 `data-whale-hidden` 隐藏挂件的全部 body 节点（类名均以 `dshw` 开头），宿主同时暂停外呼与提示。

## Alternatives considered

- 按上游规格用 React 重写：无法覆盖泡泡编辑器、音效组与裁剪、角色图库、记账面板等数万行交互，外观也难以与原版一致，后续上游更新需要逐项重做。
- 在 Pages Functions 或桌面网关实现 `/dsh-whale/*`：网页版没有按用户隔离的可写存储，两端还需各写一套；页面内宿主一份代码同时服务两端。
- Service Worker 拦截 `/dsh-whale/*`：桌面 WebView 不保证可用，且 Worker 拿不到页面内的 Key 与对话状态。
- 运行时从 CDN 加载上游脚本：等于在应用源中执行未审阅的远程代码，并需放宽 `script-src`。
- 把素材提交进仓库：违反上游素材的许可范围。

## Consequences

- 挂件界面为中文（上游未做多语言），日文用户在插件页有说明。
- 升级上游版本需要替换 `upstream/whale-widget.js`，同步 `WHALE_WIDGET_VERSION`，并核对宿主路由的数据形状是否变化。
- 每轮消耗来自余额差，同一 Key 在别处的消费也会计入；扣费延迟超过 2.5 秒时本轮消耗会计入下一次观测。
- 多标签页同时打开时各自持有内存副本，最后写入者生效。
- `window.fetch` 与 `HTMLImageElement.prototype.src` 的接管是全局的，只匹配同源 `/dsh-whale/` 前缀；新增同前缀的路由会被挂件宿主截获。

## Verification

- `npm run typecheck`、`npm run lint`（仅保留既有的 `react-hooks/incompatible-library` 警告）：通过。
- `npm run test:unit`：548 项通过，含记账内核、峰谷规则、宿主路由（余额与记账、stale 回退、每轮消耗结算、隐藏时暂停、外观设置合并、SVG 泡泡框净化、角色上传删除、音效组静音槽、模型写操作拒绝）、页面接管与插件页测试。
- `npm run test:functions`：340 项通过。
- `npx playwright test --project=desktop-1440`：19 项通过。
- `npm run dev:mock` + Chromium（CDN 请求路由到 npm 包内素材）：挂件、余额泡泡、主菜单、小鲸鱼记账、关于面板、音效设置、泡泡编辑器、吸附设置、资源管理、拖到左侧镜像翻转、每轮消耗泡泡、插件开关隐藏与恢复均已截图核对，浅色与深色主题下无运行时错误。
