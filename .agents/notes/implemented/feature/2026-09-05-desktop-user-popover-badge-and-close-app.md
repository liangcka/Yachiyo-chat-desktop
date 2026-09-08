# Agent Note: 桌面端用户弹出卡片可用性、称号排序、无积分与原生浏览器呼起

- **状态**：implemented
- **日期**：2026-09-05
- **分类**：feature
- **关联组件**：[SidebarUserPopover.tsx](file:///d:/程序/web/Yachiyo-chat-desktop/src/views/desktop/sidebar/SidebarUserPopover.tsx), [SidebarFooter.tsx](file:///d:/程序/web/Yachiyo-chat-desktop/src/views/desktop/sidebar/SidebarFooter.tsx), [user-settings.ts](file:///d:/程序/web/Yachiyo-chat-desktop/src/services/user-settings.ts), [desktop-bridge.ts](file:///d:/程序/web/Yachiyo-chat-desktop/src/services/desktop-bridge.ts), [lib.rs](file:///d:/程序/web/Yachiyo-chat-desktop/src-tauri/src/lib.rs)

## 背景与动因
1. 称号系统：用户卡片顶部的徽章点击后可自由切换称号（Lite / Go / Plus / Pro / 自定义），排序以 Pro 为最右侧；
2. 彻底去除伪样板：删除原用户卡片中的积分数值与每日签到卡片；删除消息通知子视图；
3. 外部链接调用：点击「报告问题」等外部链接必须呼起操作系统的外部独立默认浏览器，严禁在 IDE 嵌入式视图或应用内 Webview 打开；
4. 关闭应用：底部替换为「关闭应用」，支持 Tauri 原生退出。

## 关键技术决策

### 1. 原生操作系统外部浏览器呼起
- 在 Tauri Rust 端（`lib.rs`）注册 `open_external_url` command：
  - 协议白名单限制（仅允许 `http` 与 `https`）；
  - Windows 下调用 `cmd /c start "" "url"`，macOS 下调用 `open`，Linux 下调用 `xdg-open`；
  - 保证直接由系统唤起独立默认浏览器，不受 IDE 或内置 Webview 劫持。
- 前端在 `desktop-bridge.ts` 中封装 `openExternalUrl(url: string)` 并在各相关入口统一调用。

### 2. 积分与签到彻底清理
- 移除 `points`、`hasCheckedInToday`、签到处理与本地存储；
- 移除右上角积分胶囊与签到小卡片，并清理相关 CSS。

### 3. 称号排序与持久化
- 预设常量定义为 `PRESET_USER_BADGES = ["Lite", "Go", "Plus", "Pro"]`，确保 **Pro 位于最右侧**；
- 本地 `localStorage` 自动持久化，多端响应式同步。

## 验证与测试
- 严格类型检查：`npm run typecheck`（Exit code 0）；
- 代码规范：`npm run lint`（Exit code 0）；
- 前端单元测试：`npm run test:unit`（35/35 文件，309/309 用例通过）；
- 桌面端 Rust 单元测试：`cargo test --manifest-path src-tauri/Cargo.toml`（48/48 测试通过）；
- 生产构建：`npm run build`（Exit code 0）。
