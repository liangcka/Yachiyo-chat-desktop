# 桌面运行时与隔离边界

当前前端统一使用 `DesktopLayout`，服务于 Tauri 原生桌面和 PC 浏览器。两种运行时共享布局、主题、会话和设置界面，后端连接方式由 `src/services/app-platform.ts` 与 API 路由适配层决定，不按屏幕尺寸切换移动版界面。

## 1. 运行时结构

```text
React 桌面界面（src/views/desktop/）
  ├─ Tauri 原生窗口
  │    └─ 本地 Rust / Axum 网关 → 模型 Provider、工作区工具、权限审批
  └─ PC 浏览器 / 已安装 PWA
       └─ Cloudflare Pages Functions → 会话鉴权、模型转发、KV 限流、联网搜索
```

浏览器显示桌面界面，不代表浏览器具有本机文件系统和终端执行权限。本地 Agent 工具依赖桌面网关与用户选择的工作区。

## 2. 目录职责

| 目录 / 文件 | 职责 |
| --- | --- |
| `src/views/desktop/` | 桌面顶栏、侧栏、对话 / 编辑器切换、成果与工作区面板 |
| `src/components/desktop/` | 项目选择、文件树、编辑器、审阅及终端等桌面组件 |
| `src/app/` | 会话状态、生命周期和前端业务控制器 |
| `src-tauri/` | Tauri 窗口、Rust 网关、本地工具与凭据存储 |
| `functions/` | PC 浏览器使用的 Cloudflare Pages Functions |
| `relay-worker/` | 独立的远程中继服务；不是桌面 UI 的启动前提 |
| `android/`、`capacitor.config.ts` | 保留的历史 Android 原生工程与配置；不提供独立移动版界面 |

`MobileLayout` 与闲置设备模式 Hook 已移除。原生平台适配、共享组件和 Capacitor 依赖继续保留，日常桌面开发不修改 Android 原生代码或构建配置。历史 Live2D 素材属于第三方作品，已从仓库移除，避免随构建产物与安装包分发。

## 3. 开发与构建

### Tauri 原生桌面

```powershell
npm install
npm run desktop:dev
```

该命令启动前端开发服务、原生窗口及桌面网关。Rust 网关与工具修改后执行 `npm run test:desktop`；生成安装包使用 `npm run desktop:build`。`tauri:dev`、`tauri:build` 是对应别名。

### PC 浏览器联调

```powershell
npm run dev:mock
```

Mock 模式包含本地 Pages Functions 与 KV 模拟。访问终端输出的地址，应用会使用 `yachiyo-local-access` 在后台建立开发会话。需要真实云函数环境变量时使用 `npm run dev:pages`。

`npm run dev` 只启动 Vite 前端，即使配置了 API 代理，也需要另行运行对应网关；不能单独用于完整接口联调。

### 验证范围

| 修改内容 | 必需验证 |
| --- | --- |
| 前端组件 / 动效 | `npm run test:unit`、`npm run build`、`npm run lint`，并检查浏览器交互 |
| Functions | `npm run test:functions` |
| Rust / Tauri | `npm run test:desktop` |
| 虚拟列表 / 长列表 | `npm run test:perf` |

## 4. 数据与权限

- 聊天历史、图片、记忆与用户资料保存在当前设备的本地存储中；浏览器与 Tauri WebView 的存储空间独立，不会自动同步。
- 桌面凭据由 Rust 本地存储管理；浏览器个人模型配置只保存在当前浏览器，调用时通过相应 API 转发。
- 本地文件、终端与 Git 工具受工作区边界和权限审批约束。展开工作区面板本身不会授予目录访问权限。
- 桌面本地模式通过本机网关连接模型，无需依赖 Cloudflare Pages；浏览器模式需要相应的 Pages Functions 服务。

具体操作见 [桌面使用指南](DESKTOP_GUIDE.md)。历史设计记录保留在 `.agents/notes/`，涉及移动端和 Live2D 的旧方案不代表当前交付范围。
