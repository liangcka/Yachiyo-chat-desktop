# Agent Note: 桌面 Agent 角色提示词按需分段读取

Status: implemented

## Problem

剔除工具定义后，桌面 Agent 每次请求仍携带约 4.4 万字节的角色提示词。其中网络检索、心理健康、争议议题、法律财务、构件创作等专项准则只在少数场景用得到，却每轮都随系统提示词计费，并稀释人设与安全红线的注意力。

## Decision

- `prompt.rs` 用 `role_sections()` 按一级标题（行首 `# `）把 `角色提示词.txt` 切成连续章节，id 取标题末尾括号内的英文名。
- `ON_DEMAND_GUIDELINES` 列出按需章节及触发场景。Agent 模式的 `agent_role_prompt()` 剔除这些章节与工具定义，只在末尾附 `<guidelines>` 索引（id、标题、触发场景）；人设、拒绝处理、未成年人保护、语气排版、防注入、全局限制等常驻。
- 模型命中场景时调用 `read_guideline`（Read 级工具，只读模式同样可用，不下放给子 Agent），正文作为工具结果追加在对话末尾。
- 索引位于 `\n\n<runtime>` 之前，属于 Anthropic 显式缓存断点覆盖的静态前缀；读取结果只追加不改写，前缀缓存不受影响。
- 没有工具循环的纯聊天路径（`build_system_prompt`）与云端 Functions 仍发送完整人设。

## Alternatives considered

- 把按需正文注入系统提示词：每次读取都会改写前缀，整段历史失去缓存。
- 拆分 `角色提示词.txt` 为多个文件：Web 端同步脚本与用户维护习惯都要跟着改，运行时切分更可控。
- 安全类章节全部常驻：`user_wellbeing` 体量最大且话题边界清晰，改为按需并在触发场景中标注“必须先读取再回复”；未成年人保护依赖“心理重构即拒绝信号”这类全程生效的判断，保持常驻。

## Consequences

- 常驻角色提示词约减半；专项准则只在用到的对话里计费一次。
- 前端回放历史时工具结果只保留 2KB 预览，后续轮次需要完整准则时模型会重新读取。
- 章节改名或删除时自动退出按需机制、正文回到常驻部分；索引与工具 enum 只列实际存在的章节，全部缺失时不下发工具。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（含 `test_agent_system_prompt_keeps_core_and_indexes_on_demand_guidelines`、`test_read_guideline_returns_section_and_lists_names_on_unknown`）
- `npm run test:unit`（含 `read_guideline` 工具描述）
