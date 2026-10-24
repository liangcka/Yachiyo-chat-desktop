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
