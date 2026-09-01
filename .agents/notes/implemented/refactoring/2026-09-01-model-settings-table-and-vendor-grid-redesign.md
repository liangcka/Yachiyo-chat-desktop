# Agent Note: 模型管理（LlmSettingsPanel）现代化重构 — 模型表格与服务商选择网格

Status: implemented

## Problem

此前模型设置面板存在以下交互与展示局限：
1. 采用单一供应商的下拉选择表单，无法像 Trae / Cursor 一样直观全局纵览已配置和预置的模型清单；
2. 缺乏便捷的添加模型服务商发现网格（如火山引擎、MiniMax、Bigmodel、阿里云、硅基流动、Kimi、OpenRouter 等）；
3. 缺少直接在模型列表中进行一键启用（Toggle 开关）、编辑（✎）和清除（🗑️）的操作交互。

## Decision

对模型管理体系进行全面现代化重构：

1. **模型管理表格（图 1 风格）**：
   - 表头清晰划分【模型】、【服务商】、【操作】三列；
   - 每行呈现模型图标、名称、服务商标签，以及编辑、删除和 Toggle 绿色启用开关；
   - 点击 Toggle 开关即可无缝切换当前激活模型，状态即时生效与持久化；
   - 顶部提供【+ 添加模型】操作按钮。
2. **添加模型模态框（图 2 风格）**：
   - 顶部通栏提供【自定义模型 (OpenAI Compatible)】卡片，支持用户自定义私有端点与模型 ID；
   - 双列响应式网格支持丰富主流服务商（DeepSeek、火山引擎、MiniMax CN/Global、Bigmodel、阿里云、Xiaomi MIMO、硅基流动、Z.ai、OpenRouter、Kimi CN/Global、BytePlus、AWS、腾讯云、魔力方舟、PPIO、StepFun、Claude、OpenAI、Gemini）；
   - 点击任一服务商直接弹出配置表单（API Key、Model ID、Base URL），一键保存并启用。
3. **完备质量保障**：
   - 更新并全量通过所有单测、云函数测试、桌面端 Rust 测试与生产构建打包。

## Verification

- npm run typecheck：0 errors
- npm run lint：0 errors
- npm run test:unit：26 个测试文件、230 个用例全部通过
- npm run test:functions：22 个测试文件、261 个用例全部通过
- npm run test:desktop：Cargo 全部测试通过
- npm run build：生产环境打包成功。
