# Agent Note: MyGO!!!!! Live2D 看板娘以静态脚本方式接入

Status: implemented

## Problem

React 深度集成版看板娘（`src/features/live2d/`）已随简化决策整体移除，`public/live2d/` 静态资源被保留备用。产品仍希望页面上有 Live2D 看板娘，但不再接受独立渲染引擎桥接、拖拽生命周期与设置项持久化带来的维护面。

## Decision

以原仓库（panxuc/live2d-widget-mygo）的零依赖脚本方式接入，全部行为由挂件自治：

1. `index.html` 在应用入口脚本后通过一行 `<script src="/live2d/autoload.js?position=right"></script>` 引入本地挂件，模型悬浮于视口右下角；挂件内置台词、换装、隐藏（`localStorage waifu-display`）等交互，均不进入 React 状态体系与设置中心。
2. 所有资源（加载器、PixiJS 渲染、5 位角色模型）由本地 `/live2d/` 路径提供，Web 与 Tauri 桌面端均可离线使用；Tauri 侧 `csp: null` 天然放行。
3. `public/_headers` 的 CSP `script-src` 增加 `'unsafe-eval'`：PIXI v6（pixi-live2d-display）运行时依赖 `new Function` 动态编译着色器，缺少该指令时 PIXI `systemCheck` 抛错、模型加载链路在 `initWidget` 阶段中断。

## Alternatives considered

- **jsdelivr CDN 引入 autoload.js**：实现同样是一行，但引入外部网络依赖，Tauri 离线场景与内网部署下挂件不可用。

- **@pixi/unsafe-eval 官方补丁（保持 CSP 严格）**：需在 PIXI 定义后、`initWidget` 调用前的极窄时序窗口注入 polyfill，意味着替换原版 autoload 加载器、复刻 position 翻转逻辑并维护 vendored 补丁；与"挂件自治、零维护面"的目标冲突，故选择放宽 CSP。现有 `script-src` 已含 `'unsafe-inline'`，追加 `'unsafe-eval'` 的增量风险有限。

## Consequences

- 看板娘完全独立于应用状态层：新增会话、切换设置均不影响挂件；挂件异常也不会波及对话主流程。

- CSP 是全站契约，`'unsafe-eval'` 放宽作用于所有页面脚本；未来若收敛 CSP，需同步评估挂件渲染路径。

- 移动端访问（屏幕宽度低于 `width_limit=768`）挂件自动不加载，与移动端隔离策略一致。

- 挂件配置仅经 autoload.js 的 URL query 传递（`width_limit` / `position` / `preload`），无持久化设置项。

## Verification

- `npm run typecheck`：通过。

- `npm run lint`：通过（仅存 1 条与本次无关的既有 warning）。

- `npm run dev:mock` 浏览器端到端实测：`#waifu` 容器定位于视口右下角，`window.live2dInstance` 建立，tomori 常服模型（moc、纹理、动作、物理）7 项资源全部 200 加载，渲染循环运行，台词气泡激活，控制台零新增 error。

