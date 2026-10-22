# Agent Note: 上游流分块切断多字节字符丢数据、工具输出落盘文件互相覆盖

Status: implemented

## Problem

1. 普通对话（`gateway::handle_chat_stream`）与 Agent（`HttpTurnExecutor`）读取上游 SSE 时逐块按 UTF-8 解码，解码失败就丢弃整块。网络分块可能切在中文等多字节字符中间，这一块连同其中的完整事件一起丢失：正文缺字，工具调用参数残缺导致执行失败、模型重试，拖慢 Agent。
2. 超长工具输出落盘到 `.yachiyo/spill/` 时文件名只精确到秒，同一秒内的两份输出写到同一个文件，前一份被覆盖，模型按提示去读时拿到的是另一份内容。

## Decision

1. 新增 `gateway::stream::SseDecoder`：按字节缓冲，凑齐以空行结尾的完整事件后再解码并提取 data。事件分隔符是 ASCII，完整事件的字节必然是完整字符。两条流式路径共用它，原先重复的分帧代码删除；缓冲区每块只整理一次，也避免了逐条事件复制剩余缓冲。
2. 落盘文件名加入进程内自增序号：`spill-{秒}-{序号}-{工具名}.txt`。

## Alternatives considered

- 只缓存块尾不完整的 UTF-8 字节、其余照旧按字符串处理：同样能修复，但两处调用点仍各自保留一份分帧代码。
- 文件名改用纳秒时间戳：Windows 系统时钟精度有限，仍有理论上的冲突。

## Consequences

- SSE 事件分隔仍只识别 `\n\n`，与修复前一致。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（新增多字节字符跨块、分帧与残留缓冲、同秒落盘不覆盖三项用例；落盘用例在修复前失败）
