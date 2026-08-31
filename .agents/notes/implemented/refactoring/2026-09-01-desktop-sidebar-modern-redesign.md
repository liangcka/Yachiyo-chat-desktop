# Agent Note: 桌面端侧边栏（DesktopSidebar）现代化视觉重构与置顶体验升级

Status: implemented

## Problem

此前桌面端侧边栏存在以下视觉与交互缺陷：
1. **视觉层次与头部冗余**：历史记录区域存在双重 Header 堆叠（全局 `历史记录` 与手风琴分组标题重复）；
2. **缺少常用会话置顶（Pin）功能**：无法将高频对话固定于最上方，查找效率受限；
3. **底部空间利用呆板**：模型状态与设置入口采用两个分离的高矩形卡片纵向堆叠，占用纵向空间且缺乏桌面级一体化精致度；
4. **快捷交互支持不足**：缺少一键深浅主题切换、语言快捷切换与会话项快捷置顶操作。

## Decision

对桌面端侧边栏进行全方位现代化重构：

1. **置顶（Pin to Top）体系**（`src/views/desktop/sidebar/`）：
   - `use-conversation-groups.ts`：扩展 `pinned` 分组提取算法与 `localStorage` 置顶 ID 集合持久化机制；
   - `SidebarGroupSection.tsx` 与 `SidebarConversationItem.tsx`：增加置顶专属金色标识徽标与置顶/取消置顶快捷切换操作。
2. **精简历史列表层级与搜索呈现**（`SidebarHistoryList.tsx`）：
   - 移除多余的顶层全局大标题，让置顶与时间分组手风琴直接呈现；
   - 搜索态仅在过滤时呈现轻量匹配计数条。
3. **一体化精致 Footer**（`SidebarFooter.tsx`）：
   - **上层 / 模型胶囊卡片**：集成 Provider 标签、当前模型名称与绿色就绪呼吸灯，点击直达模型设置；
   - **下层 / 快捷工具坞**：横向紧凑工具栏，集成深浅主题切换（☀️/🌙）、语言切换（🌐 ZH/JA）与系统设置中心（⚙️）。
4. **视觉与质感全面升级**（`src/styles/desktop.css`）：
   - 品牌 Header 增加微星徽标与更平滑的折叠动画；
   - 新建对话按钮采用圆角微立体胶囊质感；
   - 活跃会话项（Active Item）升级为微光高亮与主色指示条；
   - 紧凑 Rail 态图标与工具坞对齐。

## Verification

- `npm run typecheck`：通过（覆盖 tsconfig.app, tsconfig.node, functions 3 份配置）；
- `npm run lint`：通过（0 errors）；
- `npm run test:unit`：26 个测试文件、235 个用例全量通过；
- `npm run test:functions`：22 个测试文件、261 个用例全量通过；
- `npm run build`：生产环境打包成功。
