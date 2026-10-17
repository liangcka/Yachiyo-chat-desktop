import type { Locale } from "../../domain/chat";

/**
 * 安全提取 URL 里的域名
 */
function extractDomain(rawUrl: string): string {
  try {
    const candidate = rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(candidate);
    return parsed.hostname || rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * 将工具调用转换为用户友好的一行动词化描述
 *
 * 映射规则：
 * - read_file → "读取 <路径>" / "<路径> を読み込み"
 * - list_directory → "查看 <路径>" / "<路径> を表示"
 * - write_file / edit_file → "编辑 <路径>" / "<路径> を編集"
 * - run_command → "运行 `<命令>`" / "`<命令>` を実行"
 * - web_fetch → "抓取 <域名>" / "<域名> を取得"
 * - git_status → "查看 Git 状态" / "Git ステータスを確認"
 * - git_diff → "查看 Git 差异" / "Git 差分を確認"
 * - todo_write → "更新任务清单" / "タスク一覧を更新"
 * - mcp__<服务>__<操作> → "<服务> · <操作>"
 */
export function formatToolDescription(
  toolName: string,
  args?: Record<string, unknown>,
  locale: Locale = "zh-CN",
): string {
  const isJa = locale === "ja-JP";

  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const service = parts[1] || "mcp";
    const action = parts.slice(2).join("__") || parts[1] || toolName;
    return `${service} · ${action}`;
  }

  switch (toolName) {
    case "read_file": {
      const path = typeof args?.path === "string" ? args.path : (typeof args?.file_path === "string" ? args.file_path : "");
      if (path) {
        return isJa ? `${path} を読み込み` : `读取 ${path}`;
      }
      return isJa ? "ファイルを読み込み" : "读取文件";
    }

    case "list_directory": {
      const path = typeof args?.path === "string" ? args.path : (typeof args?.dir_path === "string" ? args.dir_path : "");
      if (path) {
        return isJa ? `${path} を表示` : `查看 ${path}`;
      }
      return isJa ? "ディレクトリを表示" : "查看目录";
    }

    case "write_file":
    case "edit_file": {
      const path = typeof args?.path === "string" ? args.path : (typeof args?.file_path === "string" ? args.file_path : "");
      if (path) {
        return isJa ? `${path} を編集` : `编辑 ${path}`;
      }
      return isJa ? "ファイルを編集" : "编辑文件";
    }

    case "run_command": {
      const command = typeof args?.command === "string" ? args.command : (typeof args?.cmd === "string" ? args.cmd : "");
      if (command) {
        return isJa ? `\`${command}\` を実行` : `运行 \`${command}\``;
      }
      return isJa ? "コマンドを実行" : "运行命令";
    }

    case "web_fetch": {
      const url = typeof args?.url === "string" ? args.url : "";
      if (url) {
        const domain = extractDomain(url);
        return isJa ? `${domain} を取得` : `抓取 ${domain}`;
      }
      return isJa ? "ウェブページを取得" : "抓取网页";
    }

    case "git_status":
      return isJa ? "Git ステータスを確認" : "查看 Git 状态";

    case "git_diff":
      return isJa ? "Git 差分を確認" : "查看 Git 差异";

    case "todo_write":
      return isJa ? "タスク一覧を更新" : "更新任务清单";

    default:
      return toolName;
  }
}
