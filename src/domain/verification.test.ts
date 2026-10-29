import { describe, expect, it } from "vitest";
import type { CommandRecord, ToolStep } from "./chat";
import { isVerificationCommand, summarizeVerification } from "./verification";

function record(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    executionId: "exec-1",
    command: "npm test",
    cwd: "D:/demo",
    exitCode: 0,
    durationMs: 1200,
    endReason: "exited",
    exitConfirmed: true,
    outputBytes: 10,
    truncated: false,
    ...overrides,
  };
}

function command(id: string, text: string, result?: CommandRecord | "legacy"): ToolStep {
  return {
    id,
    name: "run_command",
    argumentsJson: JSON.stringify({ command: text }),
    ...(result === undefined
      ? {}
      : { result: { output: "", isError: result !== "legacy" && result.exitCode !== 0, durationMs: 1, ...(result === "legacy" ? {} : { command: result }) } }),
  };
}

function edit(id: string, path: string, isError = false): ToolStep {
  return { id, name: "edit_file", argumentsJson: JSON.stringify({ path, old_string: "a", new_string: "b" }), result: { output: "ok", isError, durationMs: 1 } };
}

describe("验证证据", () => {
  it("识别构建、测试与检查命令，只读查询不算验证", () => {
    expect(isVerificationCommand("npm run test:unit")).toBe(true);
    expect(isVerificationCommand("cargo test --manifest-path src-tauri/Cargo.toml")).toBe(true);
    expect(isVerificationCommand("cd app && npx vitest run")).toBe(true);
    expect(isVerificationCommand("pytest -q")).toBe(true);
    expect(isVerificationCommand("git status")).toBe(false);
    expect(isVerificationCommand("ls tests")).toBe(false);
    expect(isVerificationCommand("cat test.log")).toBe(false);
  });

  it("识别在命令开头执行的项目测试与检查脚本，读取或编辑脚本不算", () => {
    expect(isVerificationCommand("sh test.sh")).toBe(true);
    expect(isVerificationCommand("./scripts/run-tests.sh --fast")).toBe(true);
    expect(isVerificationCommand("cd app && bash scripts/check.sh")).toBe(true);
    expect(isVerificationCommand("pwsh -NoProfile -File .\\scripts\\lint.ps1")).toBe(true);
    expect(isVerificationCommand("cat test.sh")).toBe(false);
    expect(isVerificationCommand("vim scripts/lint.sh")).toBe(false);
  });

  it("没有验证命令时为未运行", () => {
    expect(summarizeVerification([edit("e1", "a.ts")]).state).toBe("not_run");
  });

  it("以退出码判断通过与失败，同一命令以最后一次为准", () => {
    const failed = summarizeVerification([command("t1", "npm test", record({ exitCode: 1 }))]);
    expect(failed.state).toBe("failed");
    expect(failed.latest[0]).toMatchObject({ status: "failed", exitCode: 1 });

    const fixed = summarizeVerification([
      command("t1", "npm test", record({ exitCode: 1 })),
      edit("e1", "src/a.ts"),
      command("t2", "npm test", record()),
    ]);
    expect(fixed.state).toBe("passed");
    expect(fixed.latest).toHaveLength(1);
    expect(fixed.latest[0]?.callId).toBe("t2");
  });

  it("验证后又修改文件则需要重新验证", () => {
    const summary = summarizeVerification([command("t1", "npm test", record()), edit("e1", "src/a.ts"), edit("e2", "src/b.ts", true)]);
    expect(summary.state).toBe("stale");
    expect(summary.latest[0]?.stale).toBe(true);
    expect(summary.modifiedAfter).toEqual(["src/a.ts"]);
  });

  it("超时、取消、未确认退出与缺少结构化记录都不算通过", () => {
    expect(summarizeVerification([command("t1", "npm test", record({ endReason: "timed_out", exitCode: undefined }))]).state).toBe("failed");
    expect(summarizeVerification([command("t1", "npm test", record({ endReason: "cancelled" }))]).state).toBe("incomplete");
    expect(summarizeVerification([command("t1", "npm test", record({ exitConfirmed: false }))]).latest[0]?.status).toBe("unknown");
    expect(summarizeVerification([command("t1", "npm test", "legacy")]).latest[0]?.status).toBe("unknown");
    expect(summarizeVerification([command("t1", "npm test")]).state).toBe("incomplete");
  });
});
