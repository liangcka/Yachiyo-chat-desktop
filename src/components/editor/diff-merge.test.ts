import { describe, expect, it } from "vitest";
import {
  parseGitStatusShort,
  revertSelectedHunks,
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

describe("toReviewHunks 与按块撤销的编号一致", () => {
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

  it("不撤销 = 当前内容，全部撤销 = 基线", () => {
    const hunks = toReviewHunks(original, modified);
    expect(revertSelectedHunks(original, modified, hunks.map(() => false))).toBe(modified);
    expect(revertSelectedHunks(original, modified, hunks.map(() => true))).toBe(original);
  });

  it("按 toReviewHunks 的编号只撤销所选块", () => {
    const hunks = toReviewHunks(original, modified);
    expect(hunks.length).toBe(2);
    // 撤销第一个块（B→b），第二个块（X）保持现状
    expect(revertSelectedHunks(original, modified, [true, false])).toBe(modified.replace("B", "b"));
    // 撤销第二个块（X→p），第一个块（B）保持现状
    expect(revertSelectedHunks(original, modified, [false, true])).toBe(modified.replace("X", "p"));
  });

  it("相邻多行增删混合场景保持行号正确", () => {
    const o = ["1", "2", "3", "4", "5"].join("\n");
    const m = ["1", "2", "x", "y", "z", "4", "5"].join("\n");
    const hunks = toReviewHunks(o, m);
    expect(revertSelectedHunks(o, m, hunks.map(() => true))).toBe(o);
    expect(revertSelectedHunks(o, m, hunks.map(() => false))).toBe(m);
  });

  it("空 diff 产生空 hunk 集合，撤销恒等", () => {
    const hunks = toReviewHunks("same\ncontent\n", "same\ncontent\n");
    expect(hunks).toEqual([]);
    expect(revertSelectedHunks("same\ncontent\n", "same\ncontent\n", [])).toBe("same\ncontent\n");
  });
});

describe("revertSelectedHunks", () => {
  const baseline = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n").replace("line 20", "line 20 用户的修改") + "\n";
  const current = baseline.replace("line 2\n", "line 2 Agent 一\n").replace("line 38\n", "line 38 Agent 二\n");

  it("只撤销所选块，基线中的用户修改与未选块保持现状", () => {
    const hunks = toReviewHunks(baseline, current);
    expect(hunks).toHaveLength(2);
    const result = revertSelectedHunks(baseline, current, [true, false]);
    expect(result).toBe(baseline.replace("line 38\n", "line 38 Agent 二\n"));
    expect(result).toContain("line 20 用户的修改");
  });

  it("不选择任何块时内容不变，全选则回到基线", () => {
    expect(revertSelectedHunks(baseline, current, [false, false])).toBe(current);
    expect(revertSelectedHunks(baseline, current, [true, true])).toBe(baseline);
  });

  it("保留文件末尾换行的差异与 CRLF", () => {
    expect(revertSelectedHunks("a\r\nb", "a\r\nb\r\nc\r\n", [true])).toBe("a\r\nb");
  });
});

