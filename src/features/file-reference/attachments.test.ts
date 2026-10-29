import { expect, it } from "vitest";
import { appendAttachments, readTextAttachment, splitMessageAttachments, type ComposerAttachment } from "./attachments";
import { parseVideoLine } from "./video-links";

function file(content: string, name = "说明.md"): File {
  return { name, size: new TextEncoder().encode(content).length, text: async () => content } as File;
}

it("文本附件保留文件名与内容并拼入消息", async () => {
  const attachment = await readTextAttachment(file("项目说明"));
  expect(appendAttachments("查看附件", [attachment])).toContain("【附件 说明.md】\n```\n项目说明\n```");
});

it("拒绝超大或二进制文件以免静默丢失内容", async () => {
  await expect(readTextAttachment(file("文".repeat(16_001)))).rejects.toThrow("16000");
  await expect(readTextAttachment(file(String.fromCharCode(0)))).rejects.toThrow("文本或代码");
});

it("视频附件以路径行拼入消息，路径行可被识别为视频", () => {
  const path = "D:\\My Videos\\片段.mp4";
  const text = appendAttachments("看看这段", [{ kind: "video", name: "片段.mp4", path }]);
  expect(text).toBe(`看看这段\n\n【视频 片段.mp4】\n${path}`);
  expect(parseVideoLine(text.split("\n").at(-1) ?? "")).toEqual({ links: [path], sole: true });
});

it("从消息末尾拆回附件，正文与附件顺序保持不变", () => {
  const attachments: ComposerAttachment[] = [
    { name: "说明.md", content: "# 标题\n\n```ts\nconst a = 1;\n```\n正文" },
    { kind: "video", name: "片段.mp4", path: "/home/me/My Videos/片段.mp4" },
    { name: "空.txt", content: "" },
  ];
  expect(splitMessageAttachments(appendAttachments("看看这些\n\n第二段", attachments))).toEqual({ text: "看看这些\n\n第二段", attachments });
  expect(splitMessageAttachments(appendAttachments("", attachments.slice(1, 2)))).toEqual({ text: "", attachments: attachments.slice(1, 2) });
});

it("正文里同形但不在末尾、或格式不完整的文字不拆", () => {
  const text = "【视频 a.mp4】\n/a.mp4\n\n后面还有正文";
  expect(splitMessageAttachments(text)).toEqual({ text, attachments: [] });
  expect(splitMessageAttachments("【附件 a.md】\n```\n没有闭合")).toEqual({ text: "【附件 a.md】\n```\n没有闭合", attachments: [] });
});
