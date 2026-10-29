import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ChatMessage } from "../domain/chat";
import { ContextMeter } from "./ContextMeter";

const message: ChatMessage = { id: "m", conversationId: "c", role: "user", text: "字".repeat(15_000), createdAt: 1, status: "complete" };

it("未过半时隐藏，用量过半后悬停可查看估计百分比", () => {
  const { rerender } = render(<ContextMeter messages={[]} />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ContextMeter messages={[message]} />);
  const button = screen.getByRole("button", { name: /上下文已用/ });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.mouseEnter(button.parentElement!);
  expect(screen.getByRole("dialog", { name: "上下文用量详情" })).toHaveTextContent("上下文估算");
  fireEvent.mouseLeave(button.parentElement!);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<ContextMeter messages={[message]} compressedUpTo={1} summary="压缩摘要" />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("厂商上报缓存时显示最近一次请求的命中率，未上报时不显示", () => {
  const reply = (usage: ChatMessage["usage"]): ChatMessage =>
    ({ id: "a", conversationId: "c", role: "assistant", text: "好", createdAt: 2, status: "complete", usage });
  const { rerender } = render(<ContextMeter messages={[message, reply({ promptTokens: 20_000, cacheReadTokens: 15_000 })]} />);
  fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
  expect(screen.getByRole("dialog")).toHaveTextContent("上次请求缓存命中75% · 15k");
  rerender(<ContextMeter messages={[message, reply({ promptTokens: 20_000 })]} />);
  expect(screen.getByRole("dialog")).not.toHaveTextContent("缓存命中");
});
