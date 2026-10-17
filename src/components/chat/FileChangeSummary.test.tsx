import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { MessageContent } from "./MessageContent";
import { OpenReviewContext } from "./review-context";

const message: ChatMessage = {
  id: "reply", conversationId: "chat", role: "assistant", status: "complete", text: "已完成修改。", createdAt: 1,
  toolSteps: [
    { id: "edit", name: "edit_file", argumentsJson: '{"path":"src/main.ts"}', result: { output: "ok", isError: false, durationMs: 1 } },
    { id: "write", name: "write_file", argumentsJson: '{"path":"README.md"}', result: { output: "ok", isError: false, durationMs: 1 } },
  ],
};

describe("每轮文件修改汇总", () => {
  it("显示在最终回答后方，过程折叠时仍能打开代码审阅", () => {
    const openReview = vi.fn();
    const { container } = render(<OpenReviewContext.Provider value={openReview}>
      <MessageContent message={message} locale="zh-CN" hideCitations={false} />
    </OpenReviewContext.Provider>);
    const card = screen.getByRole("region", { name: "修改了 2 个文件" });
    expect(card).toBeVisible();
    expect(card).toHaveTextContent("src/main.ts");
    expect(card).toHaveTextContent("README.md");
    expect(screen.getByText("已完成修改。").compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".message-process")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "查看改动" }));
    expect(openReview).toHaveBeenCalledOnce();
    expect(card.querySelector("[style]")).toBeNull();
  });

  it("支持日文；缺少桌面审阅入口时不触发空操作", () => {
    render(<MessageContent message={message} locale="ja-JP" hideCitations={false} />);
    expect(screen.getByRole("region", { name: "2 個のファイルを変更" })).toBeVisible();
    expect(screen.getByRole("button", { name: "変更を確認" })).toBeDisabled();
  });

  it("流式消息与只有失败写入的消息不显示汇总", () => {
    const { rerender } = render(<MessageContent message={{ ...message, status: "streaming" }} locale="zh-CN" hideCitations={false} />);
    expect(screen.queryByText(/修改了 \d+ 个文件/)).toBeNull();
    rerender(<MessageContent message={{ ...message, toolSteps: message.toolSteps!.map((step) => ({ ...step, result: { ...step.result!, isError: true } })) }} locale="zh-CN" hideCitations={false} />);
    expect(screen.queryByRole("button", { name: "查看改动" })).toBeNull();
  });
});
