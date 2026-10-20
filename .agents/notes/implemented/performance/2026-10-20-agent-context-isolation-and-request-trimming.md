# Agent Note: 进一步压缩桌面端 API 调用

Status: implemented

## Problem

在提示词缓存友好化之后，仍有三处可观的浪费：

1. 调查类任务的全部工具输出都留在主上下文中，后续每一轮重复计费。
2. Agent 系统提示词里「最高行动准则 / 未绑定项目」说明写了两遍（开头一次、`<runtime>` 内一次）。
3. 每次点开一个标题仍是启发式标题的旧对话，都会发起一次 AI 标题生成请求；生成失败或结果被判定无效时，下次点开还会再请求。

## Decision

1. 新增子 Agent（见同日的子 Agent Note）：调查交给不带人设提示词的子循环，主上下文只收最终报告。主 Agent 提示词说明在只需要结论的大范围检索时使用 `task`。
2. 删除 `<runtime>` 内重复的优先准则。
3. 删除选择会话时的 AI 标题升级，只保留对话正常完成后的那一次。

## Alternatives considered

- 子 Agent 改用更便宜的模型：需要新增设置项，暂不做。
- 缩小 `read_file` 的回填上限：会影响大文件的阅读效果，已有的 8K 修剪器足以控制单条输出。

## Consequences

- 旧对话不再在被点开时自动获得 AI 标题，可手动重命名或继续对话后由完成流程升级。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run test:unit`
