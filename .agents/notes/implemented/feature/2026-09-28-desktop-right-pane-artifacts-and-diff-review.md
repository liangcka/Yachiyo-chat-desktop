# 成果展示台与多功能审阅面板（阶段三）实施记录

**日期**：2026-09-28  
**类型**：Feature / Architecture Refactor  
**范围**：桌面端交互架构、成果工件画廊、代码逐块审阅与三栏自适应协作面板  

---

## 1. 目标与背景

现代 AI 协作工具（如 Antigravity / Codex）具有清晰的职能分区：
- **右侧面板（成果与预览区）**：“成果展示台”，负责呈现 AI 的工作结果，包括：
  1. 代码文件修改的逐块对比与可视化审阅（Hunk Review）；
  2. Monaco 源码实时预览与编辑；
  3. 多模态生成图片（支持全屏灯箱预览与下载）、新建/更新文件、终端执行命令的工件流卡片；
  4. 工作区目录树与终端交互。

本方案在保持原有双栏极简沉浸感的前提下，提供按需展开、支持拖拽调整宽度（320px~760px）与全局快捷键（`Ctrl+B`）唤起的右侧多功能成果审阅面板。

---

## 2. 核心架构与组件设计

```text
src/
  components/desktop/
    ArtifactsPaneView.tsx     # 成果工件画廊视图（多模态图片+全屏灯箱、代码操作、命令执行步骤）
    ArtifactsPaneView.test.tsx # 单元测试（空状态、产物提取、一键跳转与差异审阅、灯箱互动）
  views/desktop/
    DesktopRightPane.tsx      # 成果与多功能审阅主面板容器（4 个核心 Tab 路由）
    DesktopLayout.tsx         # 桌面端主外壳（三栏 Grid 自适应、列宽持久化、Ctrl+B 快捷键、DragHandle）
    DesktopTopBar.tsx         # 顶栏右侧面板展开/收起按钮
    DesktopChatArea.tsx       # 对话顶栏右侧“成果审阅”胶囊按钮
```

### 2.1 成果工件画廊 (`ArtifactsPaneView`)
- 从当前会话的 `ChatMessage` 流中实时提取：
  - **多模态视觉图像**：带悬浮遮罩、一键放大灯箱预览（支持 Esc 或点击遮罩关闭，符合 WAI-ARIA 语义）；
  - **代码写/改操作**：提取 `write_file` 和 `replace_file_content`，展示文件路径、执行状态，支持一键在编辑器打开及一键查看改动差异；
  - **终端执行指令**：提取 `run_command`，展示 `$ <command>` 及实时执行输出。
- 顶部提供产物数量统计徽章与直达“差异审阅”的快捷跳转按钮。

### 2.2 Codex 风格代码逐块审阅 (`DiffReviewPanel`)
- 整合既有 `DiffReviewPanel`，在右侧面板的“代码审阅”Tab 中提供逐行差异对比与按块 Accept / Reject 决策，使 AI 生成的代码改动在入库前完全可控。

### 2.3 状态管理与布局自适应
- **右侧面板宽度与展开状态**：
  - 采用 `localStorage` 持久化 `yachiyo-right-pane-open`、`yachiyo-right-pane-width`、`yachiyo-right-pane-tab`；
  - 默认状态为关闭（保持默认轻量双栏，严格保护已有测试契约）；
  - 支持 `position="right"` 的 `DragHandle`，向左拖拽拉宽、向右拖拽收窄，范围约束在 320px ~ 760px；
  - 提供 `Ctrl/Cmd + B` 快捷键，支持全局瞬时切换展开/收起。

---

## 3. 验证与门禁检查

本次改动已通过全部前置验证门禁：
1. **类型检查**：`npm run typecheck`（覆盖应用、Node 脚本及 Functions 三份 tsconfig，0 errors）；
2. **静态规范**：`npm run lint`（0 errors, 1 warning）；
3. **前端全量单元测试**：`npm run test:unit`（42 个测试文件，370 个用例 100% 通过）；
4. **服务端云函数测试**：`npm run test:functions`（22 个测试文件，271 个用例 100% 通过）。
