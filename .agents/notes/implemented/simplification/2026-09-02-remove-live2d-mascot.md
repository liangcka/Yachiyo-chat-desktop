# Agent Note: 移除 MyGO!!!!! Live2D 看板娘功能

Status: implemented

## Problem

Live2D 看板娘挂件系统（含 `src/features/live2d/` 模块、`live2d-settings` 持久化服务与设置中心入口）与产品的核心对话体验无耦合，但带来了持续的维护面：独立渲染引擎桥接、拖拽交互生命周期、`SharedViewProps` 契约膨胀与额外的持久化状态。产品决策不再需要该挂件功能。

## Decision

整体移除看板娘功能代码，同时保留 `public/live2d/` 模型静态资源目录以便未来重新接入：

1. 删除 `src/features/live2d/` 全部组件、hooks、引擎桥接、台词与模型元数据及其测试。
2. 删除 `src/services/live2d-settings.ts` 与其测试；`AppSetting` 联合类型中移除 `live2dSettings` 键（Dexie schema 无需版本变更，settings 表按 key 存储）。
3. `App.tsx` 移除 Live2D 服务注入、状态同步、设置变更回调与 `<Live2dWidget>` 挂载；`SharedViewProps` 中移除 `live2dSettings` 与 `onLive2dSettingsChange`。
4. 设置中心（SettingsModal）移除「MyGO!!!!! Live2D 看板娘」整个设置分组。
5. 旧用户 IndexedDB 中残留的 `live2dSettings` 记录为无害死数据，不做迁移清理。

## Alternatives considered

- **默认关闭但保留代码**：保留全部代码路径与测试维护成本，仅省去挂载渲染，收益有限。

- **连同** **`public/live2d/`** **静态资源一并删除**：模型资产体积大且重新收集成本高，保留资源使未来恢复接入只需重建代码层。

## Consequences

- `SharedViewProps` 契约与 App 状态层回归精简，设置中心不再暴露看板娘入口。

- `public/live2d/` 资源目录暂存于仓库，若确认不再恢复可另行删除。

- 未来重新接入时以 `archived/architecture/2026-09-01-live2d-mascot-refactoring.md` 为历史参考。

## Verification

- `npm run typecheck`：通过。

- `npm run lint`：通过。

- `npm run test:unit`：通过（Live2D 相关测试文件随模块一并移除）。

