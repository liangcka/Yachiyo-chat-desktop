# Agent Note: 设置「插件」页与余额小鲸鱼

Status: implemented

## Problem

用户希望接入 DeepSeek-Balance-Whale-Widget（窗口角落显示 DeepSeek 余额的鲸鱼娘挂件），并在设置里单独提供插件开关。上游是 DeepSeek Harness 的宿主插件：前端脚本依赖 25 个 `/dsh-whale/*` 宿主接口，宿主侧是依赖 DSH 插件框架与 `~/.dsh` 文件读写的 Node 代码，本项目的 Rust 网关与 Cloudflare Pages Functions 都无法原样承载。上游 `PROVENANCE.md` 声明美术素材不在 MIT 范围内、不授予再许可。

## Decision

- 原生实现核心功能：余额（总额 / 赠金 / 充值）、今日已用、峰谷时段倒计时、拖动并吸附到左右两侧（贴左时水平翻转）、点击刷新、60 秒自动刷新（页面可见时）、DeepSeek 回复结束后按余额变化提示本轮消耗。
- 余额接口为两端同名的 `POST /api/deepseek/balance`，成功时原样返回 DeepSeek `/user/balance` 的 JSON，错误体统一为 `{ error: { code } }`：
  - 网页版 Pages Function 校验同源与会话后，用请求体里浏览器本地保存的 Key 转发；mock 模式返回固定余额且不外呼。
  - 桌面网关不接收 Key，只取系统加密存储中绑定原生端点的 DeepSeek Key（绑定自定义端点的 Key 不会被发往官方接口），无 Key 返回 `API_KEY_MISSING`。
- 币种选择（有余额的 CNY → 任意有余额币种 → CNY → 第一项）与按日账本（余额下降计为消费，上升只移动基准，跨天或换币种重新起账）在前端完成，账本与挂件位置存 localStorage。
- 鲸鱼娘形象不收录进仓库，运行时从 jsDelivr 加载 npm 包 `dsh-whale-widget@<版本>/assets/DSniang1.png`；加载失败时退回自绘的 `WhaleMark`。网页与桌面 CSP 相应放行 `img-src https://cdn.jsdelivr.net` 与 `connect-src https://data.jsdelivr.com`。
- 设置新增「插件」页：小鲸鱼总开关（默认关闭）、每轮消耗提示开关、未配置 DeepSeek Key 时的引导；「鲸鱼娘素材」一栏通过 jsDelivr 数据接口查询上游最新版本，用户确认后更新所用素材版本。版本号只接受纯数字三段式，防止拼入 CDN 地址时被注入路径。
- 插件设置存 localStorage（`yachiyo-plugin-settings`），设置页改动经同页事件即时生效。

## Alternatives considered

- 原样内置上游前端并重写宿主接口：核心接口之外还有音效片段、自定义角色、泡泡图上传、多厂商余额、Codex 统计等数千行宿主逻辑，要么重写要么让对应功能报错，且上游每次更新都要跟进兼容层。
- 把素材文件提交进仓库：违反上游素材的许可范围。

## Consequences

- 不包含上游的泡泡编辑器、音效、自定义角色与多厂商余额。
- 本轮消耗来自余额观测差值，同一 Key 在别处的消费也会计入；DeepSeek 扣费延迟超过 2.5 秒时，这一轮的消耗会计入下一次观测。
- 峰谷规则按上游文档（北京时间工作日 9–12、14–18 点高峰，周末全天谷价），未处理法定节假日。
- 离线或 jsDelivr 不可达时显示内置鲸鱼；上游在新版本中改名素材文件时同样退回内置鲸鱼。

## Verification

- `npm run typecheck`、`npm run lint`（仅保留既有的 `react-hooks/incompatible-library` 警告）：通过。
- `npm run test:unit`：542 项通过，含余额选择、账本、峰谷时段、挂件与插件页测试。
- `npm run test:functions`：340 项通过，含余额代理的鉴权、转发、错误映射与 mock 模式。
- `cargo test --manifest-path src-tauri/Cargo.toml`：全部通过，含网关余额路由的 token 门禁与端点绑定测试。
- `npx playwright test --project=desktop-1440`：19 项通过。
- `npm run dev:mock`：浅色与深色主题下的挂件、详情卡片、本轮消耗提示、贴左翻转与插件页检查更新均已截图核对（CDN 请求路由到上游素材）。
