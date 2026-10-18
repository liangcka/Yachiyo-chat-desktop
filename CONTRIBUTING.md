# Yachiyo Chat Desktop 贡献指南

当前维护范围为 Tauri 桌面端与 PC 浏览器界面。共享前端统一使用 `DesktopLayout`，不再按屏幕宽度切换移动版入口。

## 参与规范

### 1. 开发环境要求
- **Node.js**: >= 22.12.0
- **npm**: >= 10.0.0
- **PowerShell / Bash**
- **Rust 稳定版与 Cargo**：运行 Tauri 桌面端、修改 Rust 网关时需要。

### 2. 本地开发与调试

```bash
# 安装依赖
npm install

# 启动本地 Mock 模式（包含本地 Pages Functions 与 KV 模拟）
npm run dev:mock
```

- 本地 Mock 模式打开地址即可，应用使用 `yachiyo-local-access` 在后台建立开发会话。
- 原生桌面开发使用 `npm run desktop:dev`，构建安装包使用 `npm run desktop:build`。
- `npm run dev` 仅提供 Vite 前端；完整接口联调必须使用上述 Mock 模式、`npm run dev:pages` 或 Tauri 本地网关。
- 桌面对话、快捷键与面板说明见 [桌面使用指南](docs/DESKTOP_GUIDE.md)。

### 3. 代码与质量检查

根据变更范围运行检查。前端组件修改执行单元测试；Functions 修改执行云函数测试；Rust 修改执行 `npm run test:desktop`。界面动效需要同时验证正常模式与系统“减少动态效果”模式。

常用前端与云函数检查：

```bash
# 1. TypeScript 类型检查
npm run typecheck

# 2. ESLint 检查
npm run lint

# 3. 前端与组件单测
npm run test:unit

# 4. Cloudflare Pages Functions 单测
npm run test:functions

# 5. 生产打包验证
npm run build
```

### 4. 发布桌面安装包

1. 同步修改三处版本号：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。
2. 提交后打标签并推送：`git tag v0.2.0 && git push origin v0.2.0`。
3. `Release` 工作流会在 Windows 上构建 `.exe`（NSIS）与 `.msi` 安装包，并创建草稿 Release；核对说明后手动发布。
4. 应用启动时会读取 GitHub 最新正式版，版本号高于本机时提示用户前往下载。草稿与预发布不会触发提示。
5. 安装包暂未签名。如需消除 SmartScreen 提示，需要购买代码签名证书，并按 Tauri 文档在 `bundle.windows` 中配置签名。

### 5. Git 提交规范

遵循常规提交格式（Conventional Commits）：
- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 代码重构
- `perf:` 性能优化
- `docs:` 文档更新
- `test:` 测试补充
- `chore:` 构建或辅助工具变动

### 6. 安全注意
- `android/`、`capacitor.config.ts` 和移动端构建脚本作为历史工程保留，桌面 UI 任务不修改这些原生文件。
- **切勿**将任何包含真实 API Key、Token 或私钥的文件（如 `.dev.vars`、`keystore.properties`、`*.jks`、`*.keystore`）提交至仓库。
- 敏感配置请使用 `.dev.vars.example` 或 `android/keystore.properties.example` 作为模板。
