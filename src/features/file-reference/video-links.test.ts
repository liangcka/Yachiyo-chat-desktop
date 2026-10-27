import { describe, expect, it } from "vitest";
import { isVideoPath, localVideoPath, parseVideoLine } from "./video-links";

describe("parseVideoLine", () => {
  it("整行是视频路径或链接时只保留播放器，本地路径允许空格", () => {
    expect(parseVideoLine("D:\\My Videos\\片段 1.mp4")).toEqual({ links: ["D:\\My Videos\\片段 1.mp4"], sole: true });
    expect(parseVideoLine("  `/Users/me/clip.webm`  ")).toEqual({ links: ["/Users/me/clip.webm"], sole: true });
    expect(parseVideoLine("[演示](https://example.com/a.MOV?t=3)")).toEqual({ links: ["https://example.com/a.MOV?t=3"], sole: true });
  });

  it("从句子里找出多个视频链接并去重，句末标点不算进链接", () => {
    expect(parseVideoLine("已导出到 `C:\\out\\a b.mp4`，预览见 https://cdn.test/v.webm。原片 C:\\out\\raw.mkv.")).toEqual({
      links: ["C:\\out\\a b.mp4", "https://cdn.test/v.webm", "C:\\out\\raw.mkv"],
      sole: false,
    });
    expect(parseVideoLine("见 https://a.test/x.mp4 与 https://a.test/x.mp4").links).toEqual(["https://a.test/x.mp4"]);
  });

  it("不把非视频文件、相对路径与网址中的路径段当成视频", () => {
    expect(parseVideoLine("a.mp4.txt 与 ./out.mp4、docs/b.mp4").links).toEqual([]);
    expect(parseVideoLine("https://a.test/page").links).toEqual([]);
    expect(parseVideoLine("https://a.test/x/y.mp4").links).toEqual(["https://a.test/x/y.mp4"]);
  });
});

describe("视频路径工具", () => {
  it("按扩展名识别视频文件", () => {
    expect(isVideoPath("D:\\v\\A.MP4")).toBe(true);
    expect(isVideoPath("notes.md")).toBe(false);
  });

  it("file:// 还原为本地路径，远程链接不算本地", () => {
    expect(localVideoPath("file:///D:/My%20Videos/a.mp4")).toBe("D:/My Videos/a.mp4");
    expect(localVideoPath("file:///home/me/a.webm")).toBe("/home/me/a.webm");
    expect(localVideoPath("C:\\a.mp4")).toBe("C:\\a.mp4");
    expect(localVideoPath("https://a.test/a.mp4")).toBeUndefined();
  });
});
