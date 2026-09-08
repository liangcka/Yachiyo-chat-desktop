# Yachiyo Chat Desktop

[![CI](https://github.com/liangcka/Yachiyo-chat-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/liangcka/Yachiyo-chat-desktop/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Yachiyo Chat Desktop 是面向动画电影《超时空辉夜姬》（超かぐや姫！ / Chou Kaguya-hime!）女主角「月见八千代（八七）」的高拟真 AI 角色伴侣与现代化桌面工作区系统。

项目采用双轨架构交付：以 Tauri v2 与 Rust 为核心构建原生桌面端体验，同时保留 Cloudflare Pages Functions 与 PWA 架构。系统融合了深海星空磨砂玻璃 UI、六大主流 LLM 厂商统一适配、DeepSeek Harness (DSH) 工业级智能体工作流（工具修剪、文件系统观察守卫、任务进度清单与主动项目探索）、深度思考链折叠展示、双阶智能会话命名、多 Provider 级联联网搜索、可组合技能系统以及纯本地隐私隔离存储。

> [!NOTE]
> **English Overview**: Yachiyo Chat Desktop is a dual-track AI companion and developer workspace dedicated to Tsukimi Yachiyo from "Chou Kaguya-hime!". Powered by Tauri v2 (Rust) for desktop and React 19 + TypeScript + Cloudflare Pages Functions for Web/PWA. Features include an immersive frameless starfield UI, DSH-aligned agent loop (tool pruning, FS observation guard, task tracking, proactive workspace exploration), deep thinking visualization, two-tier conversation titling, multi-provider LLM routing (StepFun / DeepSeek / GLM / OpenAI / Claude / Gemini), cascading web search, local avatar cropping, and offline storage via IndexedDB.

---

## 灵感来源与项目概念

本项目高度还原了动画电影《**超时空辉夜姬**》（《超かぐや姫！》/ *Chou Kaguya-hime!*）官方 **ray MV 0分52秒** 中出现的经典彩页场景——**拿出手机与桌面端设备，与月见八千代进行跨越次元的日常聊天陪伴与协作**。

<div align="center">
  <table>
    <tr>
      <td align="center" width="55%">
        <b>《超かぐや姬！》ray MV 0:52 彩页场景</b><br><br>
        <img src="docs/images/ray_mv_0m52s.png" alt="超时空辉夜姬 ray MV 0分52秒彩页" width="100%" />
      </td>
      <td align="center" width="45%">
        <b>Yachiyo Chat 实际界面还原（识图与角色对话）</b><br><br>
        <img src="docs/images/chat-mobile-main.png" alt="Yachiyo Chat 聊天界面" width="75%" />
      </td>
    </tr>
  </table>
</div>

> [!NOTE]
> **关于动态形象支持**：目前项目交互主要采用星空磨砂玻璃、头像与动作气泡交互，已包含 Live2D 扩展插槽与编剧室架构，期待后续社区创作者或官方 Live2D 模型的接入与支持。

---

## 核心功能与架构特性

### 1. 沉浸式一体化桌面端 (Tauri v2 + Rust)

- **无边框沉浸顶栏 (Frameless Title Bar)**：移除操作系统默认原生标题栏，采用高度 38px 的一体化现代顶栏，集成品牌徽标、工作区视图切换胶囊（对话与编剧室）、原生窗口控制组（最小化、最大化/还原、关闭）及自定义拖拽区域。
- **本地 Rust 网关 (Axum Gateway)**：桌面端内置高性能 Rust 本地服务，提供统一流式代理与客户端事件广播，支持离线或本地直连各大厂商 API。
- **项目工作区管理**：原生支持选择本地工程目录，双端状态强一致同步。

### 2. 桌面端 IDE Agent 模式 (对齐 DSH 工业级规范)

针对长会话、复杂重构与代码审查场景，系统实现了完整的智能体工具循环，并严格对齐 DeepSeek Harness (DSH) 工业级工程规范：

- **无模型工具结果智能修剪 (Tool Result Pruner)**：
  对齐 DSH `compaction-tool-result-pruner` 规范。当单项工具调用输出（如读取大型文件或命令日志）超过 8192 字符预算时，自动保留头部与尾部关键信息并以无模型方式折叠中间冗余，有效防止上下文与 Token 膨胀，保护上游 LLM 的 KV-Cache 命中率。同时保持前端与持久化存储中的原始完整数据，做到审查零失真。
- **文件系统观察守卫 (FS Observation Policy)**：
  对齐 DSH `fs-observation-policy` 规范。会话级追踪文件读取状态与修改时间戳（mtime）。在写入文件前强制要求先读后写，杜绝未读盲写破坏代码；并在写入时进行 CAS 版本校验，若文件在读取后被外部进程修改则自动拦截并提示重读，避免冲突覆盖。
- **任务进度清单与 Plan Strip (Tool Todo)**：
  对齐 DSH `tool-todo` 规范。提供 `todo_write` 工具，支持模型自主将复杂多步任务拆解为清单；前端在输入框上方提供具备呼吸灯高亮、展开/折叠与完成度统计的星空玻璃任务进度条（Plan Strip）。
- **超大工具输出落地与引导 (Spill Policy)**：
  对齐 DSH `spill-policy` 规范。当命令输出超过阈值时，自动将完整日志写入本地 `.yachiyo/spill/` 目录，并向模型返回双向检索指引。
- **工作区深度感知与主动探索准则 (Action-first)**：
  系统动态扫描工作区顶层文件与工程结构注入上下文；当用户提出「这是什么」、「分析项目」等疑问时，模型遵循主动探索准则，优先自主调用工具查阅实际代码与说明文档，杜绝凭空捏造事实。

### 3. 月见八千代 角色交互与情感陪伴

- **人设还原与流式交互**：八千代拥有贯通岁月长河的记忆人设，回复带括号动作心理描写，支持随时中断生成并保留已生成内容。
- **深度思考可视化 (ThinkingBlock)**：全面支持 DeepSeek R1、Claude、Gemini 等模型的推理思维链（`reasoning_content` / thinking），提供折叠展示、思考耗时统计与平滑流式展开。
- **两阶平滑智能会话命名**：
  首轮对话完成后立即采用启发式零延迟命名更新界面；随后在后台异步调度大模型进行主题提炼，概括讨论核心并过滤客套前缀，实现平滑升级与历史孤儿会话全链路自愈。
- **本地个性化资料与圆形头像裁剪**：
  完全保存在本地的个性化配置（用户名与头像）。集成大视口、无黑边全覆盖算法的圆形头像裁剪器，支持缩放、拖拽与顺时针旋转，并将用户名自然注入对话前置元数据。
- **长期记忆与可组合技能**：
  内置记忆管理面板；提供深度思维、情感洞察、精准事实、知识条理与 Humanizer（真人文风去 AI 味）五项可组合技能。

### 4. 多厂商 LLM 路由矩阵

支持国内与国际六大厂商自由切换，个人 API Key 仅保存在本地客户端，双端无缝支持流式回复与视觉识图（Vision）：

| 分组 | 厂商 | 模型支持 | 视觉模型 |
| ---- | ---- | -------- | -------- |
| 国内 | 阶跃星辰 StepFun | step-3.7-flash, step-plan 等 | 支持 |
| 国内 | DeepSeek | deepseek-chat, deepseek-reasoner | 支持（实验性） |
| 国内 | 智谱 GLM | glm-4-plus, glm-4v-flash 等 | 支持 |
| 国际 | OpenAI | gpt-4o, gpt-4o-mini 等 | 支持 |
| 国际 | Anthropic | claude-3-7-sonnet, claude-3-5-sonnet 等 | 支持 |
| 国际 | Google Gemini | gemini-2.5-pro, gemini-2.5-flash 等 | 支持 |

### 5. DSH 联网搜索管道 (WebRuntime Router)

基于 DeepSeek Harness 的 `packages/web/` 模块规范设计：

- **智能意图门控与多词提取**：自动判断是否需要联网，并提取去除停用词的精炼关键词。
- **统一级联容灾路由**：
  支持 DeepSeek 搜索、Exa 神经搜索、Tavily 事实搜索、Perplexity、Brave、博查、SearXNG、Google 自定义搜索、Jina AI 语义搜索，以及基于 Bing / DuckDuckGo 的免 Key 多路轮询兜底。
- **SearchSieve 证据清洗与正文抓取**：自动过滤黑名单与低质站点；对 Top 3 结果并行抓取正文段落注入系统上下文，参考来源随消息持久化保存。

---

## 技术栈

| 层次 | 技术选型 | 说明 |
| ---- | -------- | ---- |
| 桌面端核心 | Tauri v2、Rust、Axum、Tokio | 无边框窗口、原生网关、本地工具集 |
| 前端框架 | React 19、TypeScript、Vite | 现代化响应式界面、严格类型 |
| 渲染与列表 | TanStack Virtual | 长消息列表高性能虚拟化滚动 |
| 本地存储 | Dexie.js (IndexedDB)、localStorage | 聊天历史、长期记忆、本地用户设置 |
| PWA / 离线 | Workbox (vite-plugin-pwa) | 离线只读缓存、应用级安装 |
| 云端边缘 | Cloudflare Pages Functions、Workers KV | 边缘 API 中间件、会话鉴权、速率控制 |
| 移动端外壳 | Capacitor 8 (Android) | 实验性移动端封装 |
| 自动化测试 | Vitest、Testing Library、Playwright | 单元测试、云函数测试、桌面端集成测试 |

---

## 快速开始

### 环境准备

- Node.js 22.12 或更高版本
- Rust 稳定版编译器与 Cargo（仅桌面端开发需要）
- npm 包管理器

### 安装依赖

```bash
git clone https://github.com/liangcka/Yachiyo-chat-desktop.git
cd Yachiyo-chat-desktop
npm install
```

### 运行方式

#### 1. 桌面端开发 (推荐)

启动基于 Tauri v2 的原生桌面开发环境：

```bash
npm run desktop:dev
```

#### 2. 本地 Mock 联调 (前端 + 本地 Pages Functions)

启动内置 Cloudflare Pages Functions 与本地 KV 模拟的环境，支持免配置完整体验：

```bash
npm run dev:mock
```

访问控制台输出的本地 URL，使用默认开发访问码：`yachiyo-local-access`。

#### 3. 生产完整联调

```bash
npm run dev:pages
```

---

## 常用脚本命令

| 命令 | 用途说明 |
| ---- | -------- |
| `npm run desktop:dev` | 启动桌面端 Tauri 开发窗口 |
| `npm run desktop:build` | 编译生成桌面端 Release 可执行程序 |
| `npm run dev:mock` | 本地 Mock 联调（内置 Pages Functions 与 KV 模拟） |
| `npm run dev:pages` | 本地完整 Pages 联调（需配置相关环境变量） |
| `npm run build` | 生产构建（自动执行提示词同步与严格类型检查） |
| `npm run sync:prompt` | 同步角色提示词至云函数自动生成代码 |
| `npm run typecheck` | 对 app、node 与 functions 执行三份 tsconfig 全量类型检查 |
| `npm run lint` | ESLint 静态代码风格与规范检查 |
| `npm run test:unit` | 前端组件与业务逻辑单元测试 |
| `npm run test:functions` | Cloudflare Pages Functions 云函数测试 |
| `npm run test:desktop` | 桌面端 Rust 单元与集成测试 |
| `npm test` | 串行运行单元测试、云函数测试与桌面端测试 |

---

## 质量门禁与工程规范

项目遵循严格的工程行为准则（Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution）。

在提交代码前，请执行基线质量门禁：

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:functions
cargo test --manifest-path src-tauri/Cargo.toml
```

### 移动端隔离规则

除明确指令要求修改移动端外，严禁修改 `android/` 目录下的任何原生代码、清单、Gradle 脚本以及顶层 `capacitor.config.ts`。所有日常功能演进均以 PC 桌面端（Tauri）与 Web PWA 为准。

---

## 隐私与安全边界

1. **本地数据绝对优先**：
   所有的聊天记录、长期记忆、图片、自定义用户名与个人头像均严格保存在当前设备的 IndexedDB 与 localStorage 中。服务端不持久化任何聊天正文或用户图片。
2. **凭据安全隔离**：
   用户在客户端填写的个人 API Key 仅保存在本地设备，调用请求直连厂商（桌面端）或随同源请求临时转发（Web 端），不存储于云端数据库。
3. **边缘防护与配额**：
   云函数接口具备 Cloudflare Workers KV 频控限制；桌面端执行系统命令具备安全白名单校验与危险指令拦截（如危险系统级删除指令）。

---

## 参与贡献

欢迎提交 Issue 与 Pull Request 协助改进项目。

- 代码规范与决策记录请参考 `.agents/notes/` 目录；
- 安全漏洞反馈请参阅 [SECURITY.md](SECURITY.md)；
- 贡献流程与代码提交守则请参考 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证分发与使用。
