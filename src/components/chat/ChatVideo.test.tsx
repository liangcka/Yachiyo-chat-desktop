import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

const bridge = vi.hoisted(() => ({
  allowAssetFiles: vi.fn(),
  assetUrl: vi.fn(async (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`),
}));
vi.mock("../../services/desktop-bridge", () => bridge);

beforeEach(() => {
  bridge.allowAssetFiles.mockReset();
});

describe("消息中的视频", () => {
  it("整行本地路径只渲染播放器，并经 asset 协议放行后加载", async () => {
    const path = "D:\\My Videos\\片段.mp4";
    bridge.allowAssetFiles.mockResolvedValue([{ path, name: "片段.mp4", size: 4 }]);
    const { container } = render(<MarkdownContent text={`【视频 片段.mp4】\n${path}`} />);

    const video = await screen.findByLabelText("视频");
    await vi.waitFor(() => expect(video.getAttribute("src")).toBe(`http://asset.localhost/${encodeURIComponent(path)}`));
    expect(bridge.allowAssetFiles).toHaveBeenCalledWith([path]);
    expect(video).toHaveAttribute("controls");
    expect(container.textContent).not.toContain(path);
    expect(screen.getByText("【视频 片段.mp4】")).toBeInTheDocument();
  });

  it("句中的远程链接保留文字并在段落后接播放器，不走本地放行", () => {
    render(<MarkdownContent text="预览：https://cdn.test/v.webm" isAssistant />);
    expect(screen.getByText("预览：https://cdn.test/v.webm")).toBeInTheDocument();
    expect(screen.getByLabelText("视频")).toHaveAttribute("src", "https://cdn.test/v.webm");
    expect(bridge.allowAssetFiles).not.toHaveBeenCalled();
  });

  it("本地文件无法放行或播放失败时退回原链接文字", async () => {
    bridge.allowAssetFiles.mockResolvedValue([]);
    render(<MarkdownContent text="/home/me/missing.mp4" />);
    expect(await screen.findByText("无法加载视频：/home/me/missing.mp4")).toBeInTheDocument();

    render(<MarkdownContent text="https://cdn.test/broken.mp4" />);
    fireEvent.error(screen.getByLabelText("视频"));
    expect(screen.getByText("无法加载视频：https://cdn.test/broken.mp4")).toBeInTheDocument();
  });
});
