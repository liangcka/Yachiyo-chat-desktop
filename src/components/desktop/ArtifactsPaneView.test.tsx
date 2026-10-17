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
            id: "step-replace",
            name: "replace_file_content",
            argumentsJson: JSON.stringify({
              TargetFile: "src/styles/app.css",
              ReplacementContent: ".box { color: red; }",
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
    expect(screen.getByText("更新文件代码")).toBeInTheDocument();
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
});
