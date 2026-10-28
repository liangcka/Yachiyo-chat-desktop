import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage, CommandRecord } from "../../domain/chat";
import { MessageContent } from "./MessageContent";

const record = (exitCode: number): CommandRecord => ({
  executionId: "e", command: "npm test", cwd: "D:/demo", exitCode, durationMs: 100,
  endReason: "exited", exitConfirmed: true, outputBytes: 0, truncated: false,
});

function message(steps: ChatMessage["toolSteps"], text = "测试都通过了！"): ChatMessage {
  return { id: "a", conversationId: "c", role: "assistant", text, status: "complete", createdAt: 1, toolSteps: steps };
}

const edit = { id: "e1", name: "edit_file", argumentsJson: JSON.stringify({ path: "src/a.ts", old_string: "a", new_string: "b" }), result: { output: "ok", isError: false, durationMs: 1 } };

describe("回复中的验证结论", () => {
  it("模型声称通过不能替代执行证据：修改了文件却没跑验证时如实说明", () => {
    render(<MessageContent message={message([edit])} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("未运行验证命令")).toBeInTheDocument();
  });

  it("以命令退出码显示失败，修复后再次通过则显示通过", () => {
    const failed = { id: "t1", name: "run_command", argumentsJson: JSON.stringify({ command: "npm test" }), result: { output: "", isError: true, durationMs: 1, command: record(1) } };
    const { rerender } = render(<MessageContent message={message([edit, failed])} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("验证失败")).toBeInTheDocument();
    expect(screen.getByText("失败（退出码 1）")).toBeInTheDocument();

    const passed = { ...failed, id: "t2", result: { output: "", isError: false, durationMs: 1, command: record(0) } };
    rerender(<MessageContent message={message([edit, failed, { ...edit, id: "e2" }, passed])} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("验证通过")).toBeInTheDocument();
  });

  it("验证后又修改代码时提示需要重新验证", () => {
    const passed = { id: "t1", name: "run_command", argumentsJson: JSON.stringify({ command: "npm test" }), result: { output: "", isError: false, durationMs: 1, command: record(0) } };
    render(<MessageContent message={message([passed, edit])} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("验证后又修改了代码，需要重新验证")).toBeInTheDocument();
    expect(screen.getByText("验证后修改：src/a.ts")).toBeInTheDocument();
  });
});
