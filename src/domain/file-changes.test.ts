import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolStep } from "./chat";
import { collectModifiedFiles, reviewableRuns } from "./file-changes";

function step(name: string, path: unknown, result: ToolStep["result"] = { output: "ok", isError: false, durationMs: 1 }): ToolStep {
  return { id: `${name}-${String(path)}`, name, argumentsJson: JSON.stringify({ path }), result };
}

const message: ChatMessage = { id: "one", conversationId: "chat", role: "assistant", status: "complete", text: "完成", createdAt: 1 };

describe("collectModifiedFiles", () => {
  it("按首次成功写入顺序汇总并去重两种文件工具", () => {
    expect(collectModifiedFiles({ ...message, toolSteps: [
      step("write_file", "./src/a.ts"), step("edit_file", "src\\a.ts"),
      step("edit_file", "src/b.ts"), step("write_file", "src/b.ts"),
    ] })).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("排除失败、未完成及其他工具的步骤", () => {
    const pending = { ...step("edit_file", "pending.ts"), result: undefined };
    expect(collectModifiedFiles({ ...message, toolSteps: [
      step("edit_file", "failed.ts", { output: "失败", isError: true, durationMs: 1 }), pending,
      step("read_file", "read.ts"), step("run_command", "command.ts"), step("write_file", "saved.ts"),
    ] })).toEqual(["saved.ts"]);
  });

  it("忽略损坏参数、非对象、空路径及错误路径类型", () => {
    const invalid = ["{", "null", "[]", '"path.ts"'].map((argumentsJson) => ({ ...step("edit_file", "bad"), argumentsJson }));
    expect(collectModifiedFiles({ ...message, toolSteps: [...invalid, step("edit_file", " "), step("write_file", 42)] })).toEqual([]);
    expect(collectModifiedFiles(message)).toEqual([]);
  });

  it.each(["streaming", "failed", "stopped"] as const)("%s 消息不提前汇总", (status) => {
    expect(collectModifiedFiles({ ...message, status, toolSteps: [step("edit_file", "a.ts")] })).toEqual([]);
  });

  it("用户消息不汇总", () => {
    expect(collectModifiedFiles({ ...message, role: "user", toolSteps: [step("edit_file", "a.ts")] })).toEqual([]);
  });
});

describe("reviewableRuns", () => {
  it("按时间倒序列出绑定了项目的运行，附带触发请求，跳过未绑定项目的运行与重复身份", () => {
    const user = (id: string, text: string): ChatMessage => ({ id, conversationId: "chat", role: "user", status: "complete", text, createdAt: 1 });
    const reply = (id: string, runId: string, workspace: string | null): ChatMessage => ({
      ...message, id, run: { id: runId, workspace, executionMode: "confirm", startedAt: Number(id.slice(1)) },
    });
    expect(reviewableRuns([
      user("u1", "修复\n  登录"), reply("a1", "run-1", "D:/alpha"),
      user("u2", "闲聊"), reply("a2", "run-2", null),
      user("u3", "重试"), reply("a3", "run-1", "D:/alpha"),
      user("u4", "更新文档"), reply("a4", "run-4", "D:/beta"),
    ])).toEqual([
      { runId: "run-4", workspace: "D:/beta", startedAt: 4, request: "更新文档" },
      { runId: "run-1", workspace: "D:/alpha", startedAt: 1, request: "修复 登录" },
    ]);
  });
});
