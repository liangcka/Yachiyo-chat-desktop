# Agent Note: 桌面 Agent 提示词缓存友好化与 token 成本压缩

Status: implemented

## Problem

桌面端所有对话都走 Agent 路径，每次请求都携带约 2.6 万字符的角色提示词。其中两处推高费用（DeepSeek 尤为明显）：

1. 当前时间（精确到秒）写在系统提示词末尾，每次请求系统提示词尾部都不同，其后的整段历史永远无法命中厂商的前缀缓存；DeepSeek 缓存命中的输入价格约为未命中的十分之一。
2. 角色提示词的「完整工具定义与交互契约」章节（约 9 千字符，占三分之一）描述的是桌面端并不存在的工具，并要求用文本形式调用，既白占输入 token，也会诱导模型调用不存在的工具。

## Decision

- `build_agent_system_prompt` 不再接收时间，系统提示词只含静态说明；`run_agent_chat_stream` 用 `build_time_note` 把时间注入最新一条用户消息开头。系统提示词与已发送的历史前缀逐字稳定，下一次请求只有最后几条消息未命中缓存。
- `prompt.rs` 通过 `role_prompt()` 在桌面端发送前剔除工具定义章节（以章节标题定位，找不到标题时原样发送）。根目录 `角色提示词.txt` 与云端 Functions 不受影响。

## Alternatives considered

- 把时间精度降到小时：仍会按小时打断缓存，且损失时段判断精度。
- 直接删改 `角色提示词.txt`：会同时影响 Web 端，且该文件由用户维护，发送前裁剪更可控。
- 历史窗口按块滑动以提高缓存命中：会让上下文在 10~20 条之间波动，影响记忆连贯，暂不采用。

## Consequences

- 若重命名角色提示词中的章节标题，需要同步 `TOOL_DEFINITIONS_START` / `TOOL_DEFINITIONS_END`，否则裁剪失效（回退为完整发送，不会出错）。
- 历史超过 20 条后窗口逐条滑动，历史部分仍会失去缓存，系统提示词部分不受影响。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（含 `test_agent_system_prompt_is_cache_friendly`）
