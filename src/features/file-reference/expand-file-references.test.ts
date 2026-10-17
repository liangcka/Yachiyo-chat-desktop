import { describe, expect, it, vi } from "vitest";
import {
  extractFileReferences,
  expandFileReferences,
  hasFileReferences,
} from "./expand-file-references";

describe("extractFileReferences", () => {
  it("支持中文路径、空格引号与无扩展名文件", () => {
    expect(extractFileReferences('看 @src/组件.tsx 和 @"docs/my guide.md" @README')).toEqual(["src/组件.tsx", "docs/my guide.md", "README"]);
  });
  it("提取空白与行首的 @ 引用并去重保序", () => {
    const text = "帮我看看 @src/app/foo.ts 和\n@src/app/foo.ts 还有 @src/bar/baz.tsx";
    expect(extractFileReferences(text)).toEqual(["src/app/foo.ts", "src/bar/baz.tsx"]);
  });

  it("不匹配 email 与无扩展名的 @ 提及", () => {
    expect(extractFileReferences("联系 someone@example.com")).toEqual([]);
    expect(extractFileReferences("叫一下 @八千代")).toEqual([]);
  });

  it("反斜杠路径归一化为 / 分隔", () => {
    expect(extractFileReferences("看 @src\\app\\foo.ts")).toEqual(["src/app/foo.ts"]);
  });

  it("紧贴前导字符（如引号、括号、中文标点）的引用可以匹配", () => {
    expect(extractFileReferences("文件（@a/b.ts）被引用")).toEqual(["a/b.ts"]);
    expect(extractFileReferences("看「@a/b.ts」")).toEqual(["a/b.ts"]);
  });

  it("hasFileReferences 与提取一致", () => {
    expect(hasFileReferences("普通消息")).toBe(false);
    expect(hasFileReferences("看 @a/b.ts")).toBe(true);
  });
});

describe("expandFileReferences", () => {
  it("无引用时原样返回且不调用读取器", async () => {
    const readFile = vi.fn();
    const text = "普通消息，无引用";
    await expect(expandFileReferences(text, readFile)).resolves.toBe(text);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("展开为文件内容块且正文保留", async () => {
    const readFile = vi.fn().mockResolvedValue("console.log(1);");
    const result = await expandFileReferences("看看 @src/a.ts 谢谢", readFile);
    expect(result.startsWith("看看 @src/a.ts 谢谢")).toBe(true);
    expect(result).toContain("【引用文件 src/a.ts】");
    expect(result).toContain("```");
    expect(result).toContain("console.log(1);");
  });

  it("读取失败以占位标注，不中断整体展开", async () => {
    const readFile = vi.fn().mockResolvedValue(undefined);
    const result = await expandFileReferences("看 @missing.ts", readFile);
    expect(result).toContain("【引用文件 missing.ts】");
    expect(result).toContain("无法读取");
  });

  it("超限内容截断并标注原始体积", async () => {
    const big = "x".repeat(40 * 1024);
    const readFile = vi.fn().mockResolvedValue(big);
    const result = await expandFileReferences("看 @big.ts", readFile);
    expect(result).toContain("内容已截断");
    expect(result).not.toContain(big);
  });
});
