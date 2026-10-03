# Agent Note: Agent 证据闭环、多步交叉验证与宿主环境陷阱纠偏机制

Status: implemented

## Problem

在桌面端「自动 Agent」模式下，当用户询问「我的显卡是什么」等系统硬件信息时，系统暴露出多层深层次的连锁问题：
1. **底层数据截断与失真**：Windows WMI 的 `Win32_VideoController.AdapterRAM` 属性为 32 位无符号整数（uint32），物理表示上限仅为 4GB（通常显示为 4293918720 字节或 0xFFFFFFFF）。现代 6G/8G/12G/16G/24G 等大显存显卡在查询时必然被截断限制在 4GB；
2. **缺乏多步交叉验证闭环（核心认知缺陷）**：Agent 在首轮工具调用拿到疑似溢出或存疑的 4GB 数据时，思维链中虽识别出可能存在溢出，但却直接停止工具循环，未发起第二轮工具调用求证真实容量；
3. **主观脑补与推诿推责（交付体验硬伤）**：Agent 凭固有记忆脑补猜测“移动版通常是 6GB”（而用户实际为 12GB 定制/特化规格），并向用户推脱说“要想看精确数字建议用 GPU-Z 查看”，违背了 Agent“亲历亲为、探查事实”的定位；
4. **单点打补丁的不可持续性**：若仅针对显卡显存写死一条提示词，无法解决内存、磁盘、网络、进程或代码排查等全场景下“遇到存疑数据草率结案与推脱”的系统性连锁缺陷。

## Decision

采取“认知闭环 + 工具层智能纠偏反馈 + 事实交付契约”的三层体系化解决方案：

1. **认知层：确立「证据闭环与存疑交叉验证铁律」（Evidence-Based Verification Protocol）**：
   - 更新 `src-tauri/src/gateway/prompt.rs` 的双语 `AGENT_TOOLS_INSTRUCTION` 与未绑定工作区 `priority_header`；
   - 明确规则：当工具执行结果存在矛盾、溢出、截断、异常或自身存疑时，**绝对严禁草率结束工具调用并向彩叶脑补猜测**，更严禁建议彩叶自行使用第三方工具查看；
   - 作为 Agent，**必须在当前循环中主动发起第二轮或多轮工具调用**，通过替代命令、深层数据源（专用诊断指令、注册表、系统日志）求证到底，直至获得确凿证据才输出最终答复。

2. **工具与执行层：宿主探查避坑与陷阱智能感知反馈**：
   - 在 `src-tauri/src/tools/shell.rs` 中实现 `detect_and_append_host_environment_hints`：当命令或输出涉及 `Win32_VideoController` 且出现 `AdapterRAM` 32 位截断特征（如 4293918720 / 4294967295）时，在工具结果末尾自动追加醒目的系统纠偏提示，明确指出 32 位限制，并直接提供 `nvidia-smi` 与注册表 64 位 `HardwareInformation.qwMemorySize` 查询命令；
   - 更新 `src-tauri/src/tools/mod.rs` 中 `run_command` 的 schema description，向模型阐明系统探查的多步交叉求证与避坑指引。

3. **交付契约层：规范技术事实交付与人设协同**：
   - 在 `角色提示词.txt` 中补充宿主系统探查与技术交付契约（`host_and_hardware_verification`），确立“事实未确证前不妄断，数据确定后严谨汇报真实规格，严禁向用户推卸自查”的标准；
   - 执行 `npm run sync:prompt` 保持 Cloudflare Pages Functions 与全端静态资产严格同步。

## Consequences

- **收益**：
  - 彻底解决了显存查询回复失真的问题，在多轮 Agent 循环中能够通过 `nvidia-smi` 或 64 位注册表精准拿到真实物理显存容量（如 12GB）；
  - 建立了通用的“存疑即多步求证”认知闭环，避免 Agent 在遇到任何环境、系统或代码存疑时产生草率脑补与推脱；
  - 保持月见八千代温柔体贴人设的同时，保证技术事实 100% 严谨可靠。
- **验证**：
  - `src-tauri/tests/tool_tests.rs`：新增纠偏提示机制与 schema 测试通过；
  - `src-tauri/tests/gateway_tests.rs`：新增证据闭环与提示词规则测试通过；
  - `cargo test --manifest-path src-tauri/Cargo.toml` 全量通过；
  - `npm run test:unit` 与 `npm run sync:prompt` 全量通过。
