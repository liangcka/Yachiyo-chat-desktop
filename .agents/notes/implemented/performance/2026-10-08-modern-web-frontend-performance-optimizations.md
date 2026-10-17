# Agent Note: 基于 Modern Web Guidance 的前端工程与渲染性能优化

Status: implemented

## Problem
在前端静态分析与产物审查中，发现存在以下性能与资源加载瓶颈：
1. **庞大重型模块侵入首屏模块图**：`EditorView`（Monaco Editor）与 `DiffReviewPanel`（diff 计算）在 `DesktopLayout.tsx` 与 `DesktopRightPane.tsx` 中被静态全量引入，导致即使仅使用对话界面的用户，其主包与模块图依然背负了编辑器及其周边逻辑的解析执行负担。
2. **PWA Service Worker 预缓存膨胀严重**：`vite.config.ts` 中的 `workbox.globIgnores` 仅排除了 worker 与 `editor.api*.js`，导致 Monaco 的 80+ 门编程语言高亮包（如 `abap`、`solidity`、`clojure` 等）以及 `toggleHighContrast` 辅助包全部被打包进 SW precache manifest，造成 108 个文件、3.7MB 的巨量预缓存，拖慢首次离线安装与启动。
3. **滚动高频样式变更与重排抖动**：`ConversationView.tsx` 中的 `syncTopScrimOpacity` 在滚动事件每一帧中无差别调用 `document.documentElement.style.setProperty("--top-scrim-opacity", ...)` 并触发状态回调，在滚动超过 40px 后持续高频向 `:root` 写入重复值，引发全局样式重计算。
4. **历史列表视口外 DOM 绘制浪费**：桌面侧边栏历史会话列表（`.desktop-sidebar__history-item`）随着对话累积存在数十至数百条节点，节点具有恒定高度（36px）但非视口节点仍被全量参与渲染管线计算。

## Decision
基于 `modern-web-guidance` 现代 Web 标准与最佳实践规范，落地以下针对性优化：
1. **JS 代码分割与按需动态加载（JavaScript Code-Splitting）**：
   - 将 `DesktopLayout.tsx` 中的 `EditorView` 以及 `DesktopRightPane.tsx` 中的 `EditorView` 与 `DiffReviewPanel` 重构为 `React.lazy()` 配合 `Suspense` 动态加载。
   - 只有在用户主动切换到编辑器视图（Ctrl+2 或对应 Tab）或打开代码差异审阅面板时，才发起对应 chunk 的网络拉取。
2. **PWA 预缓存精简与 Monaco 资产缓存策略分流（Service Workers & Caching Strategies）**：
   - 配置 Vite `rollupOptions.output.chunkFileNames`，将所有 `monaco-editor` 相关 chunk 统一路由至 `assets/monaco/[name]-[hash].js`。
   - `workbox` 中追加 `**/monaco/**` 排除项，使预缓存清单从 108 个文件（3.7MB）骤降至 21 个核心应用外壳文件（2.0MB），体积缩减约 45% 并消除所有无用语法高亮包预缓存。
   - 在 `workbox.runtimeCaching` 中为 `/assets/monaco/.*\.js$/` 配置 `CacheFirst` 与 30 天过期规则，实现 Web 端首次使用编辑器后自动离线缓存，兼顾极速首屏与离线能力。
3. **滚动样式写入幂等与变更防重（Scroll Performance Throttling）**：
   - 在 `syncTopScrimOpacity` 中引入进度字符串及布尔状态缓存检测，仅在实际数值改变时才调用 `setProperty` 与通知 `onScrolledFromTopChange`。滚动长会话时消除所有冗余 DOM 样式写入。
4. **长列表视口外渲染延迟（`content-visibility: auto`）**：
   - 为 `.desktop-sidebar__history-item` 注入 `content-visibility: auto` 与 `contain-intrinsic-size: auto 36px`，浏览器自动跳过非视口历史项的排版与绘制计算，确保长历史平滑无布局抖动。

## Alternatives considered
- **完全剥离 Monaco 改为简易 textarea**：会丢失代码语法高亮与就地编辑能力，不符合桌面端一体化工作区诉求。通过 `React.lazy()` + chunk 分离已完全解决首屏负担。
- **全局拦截 scroll 事件并用 rAF 节流**：增大了调用栈深度与复杂度；直接在回调入口实现幂等短路比较最为轻量直接（Simplicity First）。

## Consequences
- **收益**：PWA 预缓存文件数从 108 降至 21，首屏 `index-*.js` 瘦身，会话滚动平滑度显著提升，代码结构完全保留类型契约与单元测试通过率。
- **代价**：首次进入代码编辑器或差异审阅时会有轻微的按需拉取延迟（已通过 Suspense fallback 优雅占位降级）。

## Verification
- `npm run typecheck`：通过（覆盖前端、桌面端、云函数 3 份 tsconfig）
- `npm run lint`：通过（0 errors）
- `npm run test:unit`：通过（44 文件，377 用例全部 passed）
- `npm run test:functions`：通过（22 文件，271 用例全部 passed）
- `npm run build`：成功构建，PWA precache 规范验证无误。
