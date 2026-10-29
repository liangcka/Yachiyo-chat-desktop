import { describe, expect, it } from "vitest";
import type { CommandRecord, ToolStep } from "./chat";
import { projectToolStep, toolKind } from "./tool-projection";

const record = (extra: Partial<CommandRecord>): CommandRecord => ({
  executionId: "e", command: "npm test", cwd: "D:/demo", durationMs: 10, endReason: "exited", exitCode: 0,
  exitConfirmed: true, outputBytes: 1, truncated: false, ...extra,
});

function step(name: string, args: unknown, result?: ToolStep["result"]): ToolStep {
  return { id: `${name}-1`, name, argumentsJson: JSON.stringify(args), ...(result !== undefined ? { result } : {}) };
}

describe("工具步骤统一投影", () => {
  it("只认网关实际提供的工具名，edit_file 与 write_file 同属文件写入", () => {
    expect(toolKind("edit_file")).toBe("file_write");
    expect(toolKind("write_file")).toBe("file_write");
    expect(toolKind("run_command")).toBe("command");
    expect(toolKind("mcp__github__list")).toBe("mcp");
    expect(toolKind("replace_file_content")).toBe("other");
    expect(toolKind("terminal")).toBe("other");
  });

  it("路径统一分隔符，命令结论以结构化记录为准", () => {
    const ok = { output: "ok", isError: false, durationMs: 1 };
    expect(projectToolStep(step("edit_file", { path: "./src\\a.ts" }, ok))).toMatchObject({ kind: "file_write", path: "src/a.ts", status: "succeeded" });
    expect(projectToolStep(step("run_command", { command: " npm test " }, { ...ok, command: record({ exitCode: 1 }) }))).toMatchObject({ command: "npm test", status: "failed" });
    expect(projectToolStep(step("run_command", { command: "npm test" }, { ...ok, command: record({ endReason: "cancelled" }) })).status).toBe("cancelled");
    expect(projectToolStep(step("run_command", { command: "npm test" }, { ...ok, command: record({ exitConfirmed: false }) })).status).toBe("unknown");
  });

  it("没有结果的步骤：运行中为 running，消息结束后为结果未知", () => {
    expect(projectToolStep(step("run_command", { command: "npm run dev" }), false).status).toBe("running");
    expect(projectToolStep(step("run_command", { command: "npm run dev" }), true).status).toBe("unknown");
  });
});
