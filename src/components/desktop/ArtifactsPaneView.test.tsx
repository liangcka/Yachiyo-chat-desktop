import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { ArtifactsPaneView } from "./ArtifactsPaneView";

describe("ArtifactsPaneView", () => {
  it("renders empty state when there are no artifacts or steps", () => {
    render(<ArtifactsPaneView messages={[]} imageUrls={new Map()} />);

    expect(screen.getByText("暂无生成产物")).toBeInTheDocument();
    expect(screen.getByText(/当 AI 在对话中生成图片、修改代码文件或执行终端命令时/i)).toBeInTheDocument();
  });

  it("extracts and renders images, file operations, and command executions", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const onOpenReview = vi.fn();

    const imageUrls = new Map<string, string>([
      ["img-1", "data:image/png;base64,mockimagedata"],
    ]);

    const messages: ChatMessage[] = [
      {
        id: "msg-1",
        conversationId: "conv-1",
        role: "assistant",
        text: "这是生成的图片成果",
        imageId: "img-1",
        createdAt: 1000,
        status: "complete",
      },
      {
        id: "msg-2",
        conversationId: "conv-1",
        role: "assistant",
        text: "正在为您更新组件文件与执行测试",
        createdAt: 2000,
        status: "complete",
        toolSteps: [
          {
            id: "step-write",
            name: "write_file",
            argumentsJson: JSON.stringify({
              path: "src/components/NewFeature.tsx",
              content: "export const NewFeature = () => <div>Hello</div>;",
            }),
            result: {
              output: "File written successfully",
              isError: false,
              durationMs: 120,
            },
          },
          {
            id: "step-edit",
            name: "edit_file",
            argumentsJson: JSON.stringify({
              path: "src/styles/app.css",
              old_string: ".box { color: blue; }",
              new_string: ".box { color: red; }",
            }),
            result: {
              output: "File updated",
              isError: false,
              durationMs: 80,
            },
          },
          {
            id: "step-cmd",
            name: "run_command",
            argumentsJson: JSON.stringify({
              command: "npm run test:unit",
            }),
            result: {
              output: "Tests passed: 10/10",
              isError: false,
              durationMs: 450,
            },
          },
        ],
      },
    ];

    render(
      <ArtifactsPaneView
        messages={messages}
        imageUrls={imageUrls}
        onOpenFile={onOpenFile}
        onOpenReview={onOpenReview}
      />,
    );

    // 统计栏信息
    expect(screen.getByText("产出工件与活动步骤")).toBeInTheDocument();
    expect(screen.getByText("（4）")).toBeInTheDocument();

    // 检查图片卡片
    expect(screen.getByText("多模态视觉图像")).toBeInTheDocument();
    const imageEl = screen.getByAltText("多模态视觉图像");
    expect(imageEl).toBeInTheDocument();

    // 检查代码文件操作卡片
    expect(screen.getByText("新建/重写文件")).toBeInTheDocument();
    expect(screen.getByText("src/components/NewFeature.tsx")).toBeInTheDocument();
    expect(screen.getByText("编辑文件")).toBeInTheDocument();
    expect(screen.getByText("src/styles/app.css")).toBeInTheDocument();

    // 检查终端命令卡片
    expect(screen.getByText("终端指令执行")).toBeInTheDocument();
    expect(screen.getByText("$ npm run test:unit")).toBeInTheDocument();

    // 测试点击打开文件与差异审阅
    const openFileBtns = screen.getAllByRole("button", { name: /在编辑器打开/i });
    expect(openFileBtns.length).toBeGreaterThanOrEqual(1);
    await user.click(openFileBtns[0]);
    expect(onOpenFile).toHaveBeenCalledWith("src/components/NewFeature.tsx");

    const reviewDiffBtns = screen.getAllByRole("button", { name: /查看改动/i });
    expect(reviewDiffBtns.length).toBeGreaterThanOrEqual(1);
    await user.click(reviewDiffBtns[0]);
    expect(onOpenReview).toHaveBeenCalled();

    // 测试点击图片开启灯箱并在灯箱中关闭
    const imgWrapBtn = screen.getByRole("button", { name: "查看图片全图" });
    await user.click(imgWrapBtn);
    expect(screen.getByRole("dialog", { name: "图像全屏预览" })).toBeInTheDocument();

    const closeLightboxBtn = screen.getByTitle("关闭预览 (Esc)");
    await user.click(closeLightboxBtn);
    expect(screen.queryByRole("dialog", { name: "图像全屏预览" })).not.toBeInTheDocument();
  });

  it("命令结论以网关记录为准，文件改动带上所属运行打开审阅", async () => {
    const user = userEvent.setup();
    const onOpenReview = vi.fn();
    const messages: ChatMessage[] = [{
      id: "msg-run",
      conversationId: "conv-1",
      role: "assistant",
      text: "",
      createdAt: 1,
      status: "complete",
      run: { id: "run-1", workspace: "D:/alpha", executionMode: "confirm", startedAt: 1 },
      toolSteps: [
        { id: "e1", name: "edit_file", argumentsJson: JSON.stringify({ path: "./src\\a.ts" }), result: { output: "ok", isError: false, durationMs: 1 } },
        {
          id: "c1",
          name: "run_command",
          argumentsJson: JSON.stringify({ command: "npm test" }),
          result: {
            output: "[结果] 失败：退出码 1",
            isError: true,
            durationMs: 1200,
            command: { executionId: "x", command: "npm test", cwd: "D:/alpha", exitCode: 1, durationMs: 1200, endReason: "exited", exitConfirmed: true, outputBytes: 10, truncated: false },
          },
        },
        { id: "c2", name: "run_command", argumentsJson: JSON.stringify({ command: "npm run dev" }) },
        { id: "r1", name: "replace_file_content", argumentsJson: JSON.stringify({ TargetFile: "x.css" }), result: { output: "ok", isError: false, durationMs: 1 } },
      ],
    }];
    render(<ArtifactsPaneView messages={messages} imageUrls={new Map()} onOpenReview={onOpenReview} />);

    expect(screen.getByText("（3）")).toBeInTheDocument();
    expect(screen.queryByText("x.css")).toBeNull();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("退出码 1 · 1.2 秒")).toBeInTheDocument();
    expect(screen.getByLabelText("失败")).toBeInTheDocument();
    expect(screen.getByLabelText("结果未知")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /查看改动/ }));
    expect(onOpenReview).toHaveBeenCalledWith({ runId: "run-1", workspace: "D:/alpha" });
  });
});
