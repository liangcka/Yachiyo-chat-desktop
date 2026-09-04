import { describe, expect, it } from "vitest";
import {
  applySelectedHunks,
  parseGitStatusShort,
  toReviewHunks,
} from "./diff-merge";

describe("parseGitStatusShort", () => {
  it("解析常规 M/??/D 状态", () => {
    const output = [
      " M src/app/a.ts",
      "?? src/new-file.tsx",
      "D  src/old.ts",
      "MM src/both.ts",
    ].join("\n");
    expect(parseGitStatusShort(output)).toEqual([
      { path: "src/app/a.ts", status: "modified" },
      { path: "src/new-file.tsx", status: "added" },
      { path: "src/old.ts", status: "deleted" },
      { path: "src/both.ts", status: "modified" },
    ]);
  });

  it("跳过 ignored 与空行", () => {
    const output = ["!! node_modules/", "", " M a.ts"].join("\n");
    expect(parseGitStatusShort(output)).toEqual([{ path: "a.ts", status: "modified" }]);
  });

  it("rename 记录取新路径", () => {
    expect(parseGitStatusShort("R  old-name.ts -> new-name.ts")).toEqual([
      { path: "new-name.ts", status: "modified" },
    ]);
  });

  it("反斜杠与引号包裹的路径归一化", () => {
    expect(parseGitStatusShort(" M src\\app\\a.ts")).toEqual([
      { path: "src/app/a.ts", status: "modified" },
    ]);
    expect(parseGitStatusShort(' M "weird name.ts"')).toEqual([
      { path: "weird name.ts", status: "modified" },
    ]);
  });

  it("英文提示语（无 HEAD 仓库的占位输出）不产生条目", () => {
    expect(parseGitStatusShort("Working tree clean (no changes)")).toEqual([]);
    expect(parseGitStatusShort("fatal: not a git repository")).toEqual([]);
  });
});

describe("toReviewHunks + applySelectedHunks", () => {
  // 两处相距足够远（> 2*context+1）的修改，确保产出 2 个独立 hunk
  const original = [
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
    "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
  ].join("\n");
  const modified = [
    "a", "B", "c", "d", "e", "f", "g", "h", "i", "j",
    "k", "l", "m", "n", "o", "X", "q", "r", "s", "t",
  ].join("\n");

  it("toReviewHunks 产出带类型的行", () => {
    const hunks = toReviewHunks(original, modified);
    expect(hunks.length).toBe(2);
    const allLines = hunks.flatMap((h) => h.lines);
    expect(allLines.some((l) => l.type === "del" && l.text === "b")).toBe(true);
    expect(allLines.some((l) => l.type === "add" && l.text === "B")).toBe(true);
    expect(allLines.some((l) => l.type === "del" && l.text === "p")).toBe(true);
    expect(allLines.some((l) => l.type === "add" && l.text === "X")).toBe(true);
  });

  it("全采纳 = 工作区内容", () => {
    const hunks = toReviewHunks(original, modified);
    const result = applySelectedHunks(original, hunks, hunks.map(() => true));
    expect(result).toBe(modified);
  });

  it("全拒绝 = 原文", () => {
    const hunks = toReviewHunks(original, modified);
    const result = applySelectedHunks(original, hunks, hunks.map(() => false));
    expect(result).toBe(original);
  });

  it("部分采纳只应用所选 hunk", () => {
    const hunks = toReviewHunks(original, modified);
    expect(hunks.length).toBe(2);

    // 只采纳第一个 hunk（b→B），拒绝第二个（p→X）
    const result = applySelectedHunks(original, hunks, [true, false]);
    expect(result).toBe(modified.replace("X", "p"));

    // 只采纳第二个 hunk（p→X），拒绝第一个（b 保持小写）
    const result2 = applySelectedHunks(original, hunks, [false, true]);
    expect(result2).toBe(original.replace("p", "X"));
  });

  it("相邻多行增删混合场景保持行号正确", () => {
    const o = ["1", "2", "3", "4", "5"].join("\n");
    const m = ["1", "2", "x", "y", "z", "4", "5"].join("\n");
    const hunks = toReviewHunks(o, m);
    const all = applySelectedHunks(o, hunks, hunks.map(() => true));
    expect(all).toBe(m);
    const none = applySelectedHunks(o, hunks, hunks.map(() => false));
    expect(none).toBe(o);
  });

  it("空 diff 产生空 hunk 集合，apply 恒等", () => {
    const hunks = toReviewHunks("same\ncontent\n", "same\ncontent\n");
    expect(hunks).toEqual([]);
    expect(applySelectedHunks("same\ncontent\n", hunks, [])).toBe("same\ncontent\n");
  });
});
