import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/chat";
import { MessageBubble } from "./MessageBubble";

const imageMessage: ChatMessage = {
  conversationId: "conversation-1",
  createdAt: 1,
  id: "user-1",
  imageId: "image-1",
  role: "user",
  status: "complete",
  text: "看看这张",
};

describe("MessageBubble", () => {
  it("随发的文件与视频像图片一样独立成卡片，文字气泡只留正文", async () => {
    const user = userEvent.setup();
    const message: ChatMessage = {
      ...imageMessage,
      imageId: undefined,
      text: "看看这些\n\n【附件 说明.md】\n```\n第一行\n第二行\n```\n\n【视频 片段.mp4】\nhttps://cdn.test/v.mp4",
    };
    const { container } = render(<MessageBubble locale="zh-CN" message={message} />);

    const bubble = container.querySelector(".message-bubble__user-bubble");
    expect(bubble?.textContent).toBe("看看这些");
    const card = screen.getByText("说明.md").closest("details");
    expect(card).not.toBeNull();
    expect(bubble?.contains(card ?? null)).toBe(false);
    expect(screen.getByText("2 行")).toBeInTheDocument();
    await user.click(screen.getByText("说明.md"));
    expect(card).toHaveAttribute("open");

    const video = screen.getByLabelText("视频");
    expect(video).toHaveAttribute("src", "https://cdn.test/v.mp4");
    expect(bubble?.contains(video)).toBe(false);
  });

  it("只有附件没有正文时不渲染空的文字气泡", () => {
    const message: ChatMessage = { ...imageMessage, imageId: undefined, text: "【视频 片段.mp4】\nhttps://cdn.test/v.mp4" };
    const { container } = render(<MessageBubble locale="zh-CN" message={message} />);
    expect(container.querySelector(".message-bubble__user-bubble")).toBeNull();
    expect(screen.getByLabelText("视频")).toBeInTheDocument();
  });

  it("opens the sent image in a full-screen preview and closes it with Esc", async () => {
    const user = userEvent.setup();
    render(<MessageBubble locale="zh-CN" message={imageMessage} imageUrl="blob:image-1" />);

    await user.click(screen.getByRole("button", { name: "放大图片" }));
    const dialog = screen.getByRole("dialog", { name: "图像全屏预览" });
    expect(dialog.querySelector("img")).toHaveAttribute("src", "blob:image-1");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "图像全屏预览" })).not.toBeInTheDocument();
  });

  it("edits in place: focuses the textarea, Esc cancels and Ctrl+Enter saves", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<MessageBubble locale="zh-CN" message={imageMessage} imageUrl="blob:image-1" onEdit={onEdit} />);

    await user.click(screen.getByRole("button", { name: "编辑消息" }));
    expect(screen.getByRole("textbox", { name: "编辑消息" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "编辑消息" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "编辑消息" }));
    await user.keyboard("吗{Control>}{Enter}{/Control}");
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith("user-1", "看看这张吗");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "编辑消息" })).not.toBeInTheDocument());
  });
});
