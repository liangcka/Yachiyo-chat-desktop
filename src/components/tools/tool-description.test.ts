import { describe, expect, it } from "vitest";
import { formatToolDescription } from "./tool-description";

describe("formatToolDescription", () => {
  describe("中文 (zh-CN)", () => {
    it("正确映射 read_file", () => {
      expect(formatToolDescription("read_file", { path: "src/App.tsx" }, "zh-CN")).toBe("读取 src/App.tsx");
      expect(formatToolDescription("read_file", { file_path: "package.json" }, "zh-CN")).toBe("读取 package.json");
      expect(formatToolDescription("read_file", {}, "zh-CN")).toBe("读取文件");
      expect(formatToolDescription("read_file", undefined, "zh-CN")).toBe("读取文件");
    });

    it("正确映射 glob 与 grep", () => {
      expect(formatToolDescription("glob", { pattern: "src/**/*.tsx" }, "zh-CN")).toBe("查找文件 src/**/*.tsx");
      expect(formatToolDescription("grep", { pattern: "useChat" }, "zh-CN")).toBe("搜索 `useChat`");
      expect(formatToolDescription("grep", {}, "zh-CN")).toBe("搜索代码");
    });

    it("正确映射 list_directory", () => {
      expect(formatToolDescription("list_directory", { path: "src/components" }, "zh-CN")).toBe("查看 src/components");
      expect(formatToolDescription("list_directory", { dir_path: "public" }, "zh-CN")).toBe("查看 public");
      expect(formatToolDescription("list_directory", {}, "zh-CN")).toBe("查看目录");
    });

    it("正确映射 write_file", () => {
      expect(formatToolDescription("write_file", { path: "notes.md" }, "zh-CN")).toBe("编辑 notes.md");
      expect(formatToolDescription("write_file", { file_path: "config.json" }, "zh-CN")).toBe("编辑 config.json");
      expect(formatToolDescription("write_file", {}, "zh-CN")).toBe("编辑文件");
    });

    it("正确映射 run_command", () => {
      expect(formatToolDescription("run_command", { command: "npm test" }, "zh-CN")).toBe("运行 `npm test`");
      expect(formatToolDescription("run_command", { cmd: "git status" }, "zh-CN")).toBe("运行 `git status`");
      expect(formatToolDescription("run_command", {}, "zh-CN")).toBe("运行命令");
    });

    it("正确映射 web_fetch 并提取域名", () => {
      expect(formatToolDescription("web_fetch", { url: "https://api.github.com/repos" }, "zh-CN")).toBe("抓取 api.github.com");
      expect(formatToolDescription("web_fetch", { url: "http://example.org/path?q=1" }, "zh-CN")).toBe("抓取 example.org");
      expect(formatToolDescription("web_fetch", { url: "localhost:3000/test" }, "zh-CN")).toBe("抓取 localhost");
      expect(formatToolDescription("web_fetch", {}, "zh-CN")).toBe("抓取网页");
    });

    it("正确映射 web_search 并展示关键词", () => {
      expect(formatToolDescription("web_search", { query: "Tauri 2 发布" }, "zh-CN")).toBe("联网搜索「Tauri 2 发布」");
      expect(formatToolDescription("web_search", {}, "zh-CN")).toBe("联网搜索");
    });

    it("正确映射 task 子 Agent 并展示任务简称", () => {
      expect(formatToolDescription("task", { description: "排查磁盘占用", prompt: "…" }, "zh-CN")).toBe("子 Agent · 排查磁盘占用");
      expect(formatToolDescription("task", {}, "ja-JP")).toBe("サブエージェント");
    });

    it("正确映射 read_guideline 并展示准则 id", () => {
      expect(formatToolDescription("read_guideline", { name: "search_instructions" }, "zh-CN")).toBe("查阅准则 search_instructions");
      expect(formatToolDescription("read_guideline", {}, "ja-JP")).toBe("ガイドラインを確認");
    });

    it("正确映射 git_status 和 git_diff", () => {
      expect(formatToolDescription("git_status", {}, "zh-CN")).toBe("查看 Git 状态");
      expect(formatToolDescription("git_diff", {}, "zh-CN")).toBe("查看 Git 差异");
    });

    it("正确映射 todo_write", () => {
      expect(formatToolDescription("todo_write", {}, "zh-CN")).toBe("更新任务清单");
    });

    it("正确映射 mcp__<服务>__<操作>", () => {
      expect(formatToolDescription("mcp__github__create_issue", {}, "zh-CN")).toBe("github · create_issue");
      expect(formatToolDescription("mcp__filesystem__read_file", { path: "a.txt" }, "zh-CN")).toBe("filesystem · read_file");
      expect(formatToolDescription("mcp__sqlite__run_query_nested", {}, "zh-CN")).toBe("sqlite · run_query_nested");
    });

    it("兜底未知工具名", () => {
      expect(formatToolDescription("custom_extension_tool", {}, "zh-CN")).toBe("custom_extension_tool");
    });
  });

  describe("日文 (ja-JP)", () => {
    it("正确映射 read_file", () => {
      expect(formatToolDescription("read_file", { path: "src/App.tsx" }, "ja-JP")).toBe("src/App.tsx を読み込み");
      expect(formatToolDescription("read_file", {}, "ja-JP")).toBe("ファイルを読み込み");
    });

    it("正确映射 glob 与 grep", () => {
      expect(formatToolDescription("glob", { pattern: "*.rs" }, "ja-JP")).toBe("*.rs のファイルを検索");
      expect(formatToolDescription("grep", { pattern: "useChat" }, "ja-JP")).toBe("`useChat` を検索");
    });

    it("正确映射 list_directory", () => {
      expect(formatToolDescription("list_directory", { path: "src/components" }, "ja-JP")).toBe("src/components を表示");
      expect(formatToolDescription("list_directory", {}, "ja-JP")).toBe("ディレクトリを表示");
    });

    it("正确映射 write_file", () => {
      expect(formatToolDescription("write_file", { path: "notes.md" }, "ja-JP")).toBe("notes.md を編集");
      expect(formatToolDescription("write_file", {}, "ja-JP")).toBe("ファイルを編集");
    });

    it("正确映射 run_command", () => {
      expect(formatToolDescription("run_command", { command: "cargo build" }, "ja-JP")).toBe("`cargo build` を実行");
      expect(formatToolDescription("run_command", {}, "ja-JP")).toBe("コマンドを実行");
    });

    it("正确映射 web_fetch 并提取域名", () => {
      expect(formatToolDescription("web_fetch", { url: "https://docs.rs/serde" }, "ja-JP")).toBe("docs.rs を取得");
      expect(formatToolDescription("web_fetch", {}, "ja-JP")).toBe("ウェブページを取得");
    });

    it("正确映射 git_status 和 git_diff", () => {
      expect(formatToolDescription("git_status", {}, "ja-JP")).toBe("Git ステータスを確認");
      expect(formatToolDescription("git_diff", {}, "ja-JP")).toBe("Git 差分を確認");
    });

    it("正确映射 todo_write", () => {
      expect(formatToolDescription("todo_write", {}, "ja-JP")).toBe("タスク一覧を更新");
    });

    it("正确映射 mcp__<服务>__<操作>", () => {
      expect(formatToolDescription("mcp__github__create_issue", {}, "ja-JP")).toBe("github · create_issue");
      expect(formatToolDescription("mcp__fetch__web", {}, "ja-JP")).toBe("fetch · web");
    });
  });
});
