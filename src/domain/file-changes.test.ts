import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolStep } from "./chat";
import { collectModifiedFiles } from "./file-changes";

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
