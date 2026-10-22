import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
});
