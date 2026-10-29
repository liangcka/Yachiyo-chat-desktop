import { describe, expect, it } from "vitest";
import type { ChatMessage, CommandRecord, ToolStep } from "./chat";
import { collectUnresolvedIssues } from "./run-result";

const command = (id: string, text: string, exitCode: number): ToolStep => {
  const record: CommandRecord = { executionId: id, command: text, cwd: "D:/demo", durationMs: 10, endReason: "exited", exitCode, exitConfirmed: true, outputBytes: 1, truncated: false };
  return { id, name: "run_command", argumentsJson: JSON.stringify({ command: text }), result: { output: "", isError: exitCode !== 0, durationMs: 10, command: record } };
};
const write = (id: string, path: string, isError: boolean): ToolStep => ({
  id, name: "edit_file", argumentsJson: JSON.stringify({ path }), result: { output: "", isError, durationMs: 1 },
});
const base: ChatMessage = { id: "a", conversationId: "c", role: "assistant", status: "complete", text: "已完成", createdAt: 1 };

describe("运行结束时仍未解决的问题", () => {
  it("同一命令或文件以最后一次结果为准，模型的结论不消除失败", () => {
    const issues = collectUnresolvedIssues({
      ...base,
      text: "测试已全部通过。",
      toolSteps: [
        command("c1", "npm test", 1), command("c2", "npm test", 0),
        command("c3", "npm run lint", 2),
        write("w1", "src/a.ts", true), write("w2", "src/a.ts", false),
        write("w3", "src/b.ts", true),
      ],
    });
    expect(issues).toEqual([
      expect.objectContaining({ kind: "command", command: "npm run lint", unknown: false }),
      { kind: "write", path: "src/b.ts" },
    ]);
  });

  it("取消收尾时无法确认的操作、没有结果的步骤与未送达的补充都列出", () => {
    const issues = collectUnresolvedIssues({
      ...base,
      status: "stopped",
      toolSteps: [{ id: "m1", name: "mcp__x__deploy", argumentsJson: "{}" }],
      cancellation: { confirmed: false, unknown: [{ callId: "m1", name: "mcp__x__deploy", detail: "未返回" }, { callId: "m2", name: "mcp__x__notify", detail: "未返回" }] },
      supplements: [{ id: "s1", text: "加个用例", createdAt: 1, state: "undelivered" }, { id: "s2", text: "已送达", createdAt: 1, state: "delivered" }],
    });
    expect(issues).toEqual([
      { kind: "unknown_operation", name: "mcp__x__deploy" },
      { kind: "unknown_operation", name: "mcp__x__notify", detail: "未返回" },
      { kind: "supplement", text: "加个用例" },
    ]);
  });

  it("运行中的消息不给出结论", () => {
    expect(collectUnresolvedIssues({ ...base, status: "streaming", toolSteps: [command("c1", "npm test", 1)] })).toEqual([]);
  });
});
