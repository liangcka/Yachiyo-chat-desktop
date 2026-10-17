import { expect, it } from "vitest";
import { appendAttachments, readTextAttachment } from "./attachments";

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
