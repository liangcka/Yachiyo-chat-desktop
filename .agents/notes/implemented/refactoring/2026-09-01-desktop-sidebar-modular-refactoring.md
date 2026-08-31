# Agent Note: 桌面端侧边栏（DesktopSidebar）现代化模块化重构

Status: implemented

## Problem

原 `DesktopSidebar.tsx` 为单文件 500+ 行实现，存在以下架构与体验问题：
1. **单一文件职责过载**：紧凑 Rail 态、手风琴时间分组算法、会话内联编辑、滚动条滞后计时、底部状态卡片全部杂糅在同一文件内，难以独立单测与维护；
2. **缺少会话快速搜索/过滤**：历史会话较多时只能依赖滚动，查找效率低；
3. **时间分组折叠偏好无持久化**：用户折叠偏好刷新即丢失；
4. **活跃态视觉指示可优化**：缺少呼吸微光与高亮指示条。

## Decision

将桌面端侧边栏重构为高内聚、关注点分离的子组件与 Hooks 体系，并升级交互体验：

1. **子模块体系与目录划分**（`src/views/desktop/sidebar/`）：
   - `DesktopSidebar.tsx`：主组合组件，协调展开态与 Rail 态；
   - `SidebarBrandHeader.tsx`：Wordmark 品牌标识与折叠按钮；
   - `SidebarNewChat.tsx`：新建对话按钮（带 Ctrl+N 快捷键标注）；
   - `SidebarSearch.tsx`：会话实时搜索过滤输入框（支持清空按钮与 Esc 快捷键）；
   - `SidebarHistoryList.tsx`：历史会话列表容器与匹配计数展示；
   - `SidebarGroupSection.tsx`：手风琴时间分组折叠组件；
   - `SidebarConversationItem.tsx`：单条会话项（内联重命名、删除操作与活跃态微光指示条）；
   - `SidebarFooter.tsx`：底部模型就绪状态与综合设置入口；
   - `SidebarRail.tsx`：56px/64px 紧凑 Rail 折叠态侧边栏；
   - `use-conversation-groups.ts`：时间分组算法、搜索过滤与 localStorage 折叠记忆 Hook；
   - `use-scrollbar-linger.ts`：滚动条离开 2 秒平滑隐去计时 Hook；
   - `index.ts` 与顶层 `DesktopSidebar.tsx`：完全向后兼容导出。

2. **搜索过滤与体验升级**：
   - 实时根据标题模糊过滤，显示匹配条数；支持 Esc / 一键清空；
   - 活跃会话项左边缘增加 3px 渐变呼吸指示条，深度融入星空玻璃视觉；
   - 手风琴折叠状态持久化至 `localStorage`。

## Verification

- `npm run typecheck`：通过（覆盖 tsconfig.app, tsconfig.node, functions 3 份配置）；
- `npm run lint`：通过（0 errors）；
- `npm run test:unit`：26 个测试文件、233 个用例全量通过（包含新增针对侧边栏子模块与搜索过滤的独立单测）；
- `npm run test:functions`：22 个测试文件、261 个用例全量通过；
- `npm run build`：生产环境构建成功完成。
