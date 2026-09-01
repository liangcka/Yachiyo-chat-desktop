# Agent Note: MyGO!!!!! Live2D 桌宠与看板娘系统现代化重构

Status: implemented

## Problem
在原有的 Live2D 看板娘实现中，系统存在以下局限：
1. 依赖 Hexo 博客风格的注入脚本（旧版 `live2d-widget-mygo`），包含非业务相关的丑陋原生工具栏和弹窗 DOM。
2. 缺乏与 React 状态体系的深度集成，无法在设置中心直观浏览与切换 5 位 MyGO 成员及其 70 余套精美立绘服装。
3. 缺乏与 AI 对话核心状态（思考流式传输、生成完成、报错等）的实时交互联动。
4. 无法自由调节尺寸缩放与背景透明度融合。

## Decision
重构并建立模块化、类型安全的 Live2D 桌面挂件系统：
1. **领域模型与元数据体系 (`src/features/live2d/types.ts`, `data/models.ts`, `data/dialogue.ts`)**：
   - 完整收录并映射 5 位 MyGO!!!!! 成员（高松灯、千早爱音、要乐奈、长崎爽世、椎名立希）的 70+ 套模型资产、立绘缩略图、角色主题色与乐队分工。
   - 结构化整合角色专属问候台词（早/中/晚/深夜时段台词、闲置台词）与 AI 状态联动预设动作（`thinking01`, `smile01`, `sing01`, `sad01` 等）。
2. **现代星空毛玻璃交互组件**：
   - `Live2dSpeechBubble`：支持角色专属徽章、流光渐变与平滑淡入淡出的毛玻璃台词气泡。
   - `Live2dQuickBar`：悬浮快捷操作栏，支持一键互动交流、立绘工坊开启、快速切人和归位回家。
   - `Live2dOutfitPicker`：可视化立绘工坊模态窗，提供 5 成员 Tab 切换、立绘卡片预览与实时换装。
3. **AI 对话状态联动机制 (`useLive2dController`)**：
   - 监听 `chatPhase`（`streaming` / `idle` / `error`），在 AI 推理思考时触发角色专注/歌唱/思考动作与专属台词；对话完成时触发欢快动作。
4. **设置中心升级 (`SettingsModal.tsx`, `live2d-settings.ts`)**：
   - 提供角色选择器、服装下拉选择、0.6x~1.4x 尺寸缩放比例滑块、0.4~1.0 不透明度滑块及 AI 联动开关。

## Alternatives considered
- **完全重写 WebGL/Live2D 底层渲染器**：开发与测试成本极高，且 Cubism 2.1 运行时在本地离线环境下表现稳定，保留底层 WebGL 渲染管线并通过 React Portal + CSS 变量接管全部 UI 与控制器为最佳平衡解。
- **保留原生 Hexo DOM 注入工具栏**：UI 风格与 Yachiyo 的星空玻璃质感严重违和且不具备 a11y 和主题自适应能力，果断彻底隐藏旧 DOM 并采用 React 组件接管。

## Consequences
- 桌宠挂件具备与现代桌面端、Web 端一致的视觉规范与流畅的动画体验。
- 保证了完全的离线可用性，所有模型与立绘资源均由本地 `/live2d/` 路径提供。
- 全量单元测试与类型系统覆盖，向下兼容旧版持久化配置。

## Verification
- `npm run typecheck`：通过（覆盖前端、桌面与云函数配置）。
- `npm run lint`：通过（0 errors）。
- `npm run test:unit`：28 个测试文件、244 个用例 100% 通过（包含 `Live2dWidget.test.tsx` 10 项针对性测试与 `live2d-settings.test.ts`）。
- `npm run test:functions`：22 个测试文件、261 个用例 100% 通过。
- `npm run build`：生产环境打包成功。
