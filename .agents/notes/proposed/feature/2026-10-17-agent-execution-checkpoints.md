# Agent Note: 桌面执行权限与逐轮检查点

Status: proposed

## Problem

工具授权仅按工具名记忆，任意 shell 命令会共享批准。内存中的逐文件备份无法恢复新建或删除的文件，也无法在应用重启后回到指定轮次。

## Proposal

请求携带 readonly、confirm 或 full_auto 执行模式，缺省为 confirm。后端执行边界独立检查模式。批准记忆绑定规范工作区与安全参数类别，复杂 shell 命令仅按完整命令记忆。

每个模型轮次在首次获批副作用前保存普通工作区文件快照，持久清单记录 runId、turn 与创建时间。恢复与 Agent 执行共用工作区互斥锁。检查点元数据路径禁止普通文件工具访问。

## Alternatives considered

- 仅拦截 write_file：无法恢复 shell 的创建、删除和修改。
- 以工具名记忆 run_command：会把无关命令一并批准。

## Acceptance criteria

只读模式拒绝写文件、shell 和 MCP。缺少显式 full_auto 时不得跳过审批。检查点可以跨实例列举，恢复修改、新建和删除，忙时拒绝恢复，路径越界和元数据篡改必须被拒绝。

## Risks

快照排除 Git 元数据、依赖与构建目录；普通宿主 shell 和 MCP 没有操作系统沙箱，工作区外副作用不受快照恢复保障。存储配额超限时在执行副作用前返回错误。
