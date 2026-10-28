import { executeDesktopAgentTool } from "../../services/desktop-bridge";

/** 单文件引用注入上限（字节），超出截断并标注 */
export const FILE_REFERENCE_LIMIT_BYTES = 32 * 1024;

/**
 * @引用语法：行首或空白/括号后的 `@路径`，路径须含扩展名（避免 email 误匹配）。
 * 捕获组 1 为工作区相对路径。
 */
const FILE_REFERENCE_PATTERN = /(?:^|[\s([{<"'、，。；：！？（）「」『』【】《》])@(?:"([^"\r\n]+)"|([^\s@"'()（）「」『』【】《》，。；：！？]+))/gu;

/** 提取文本中的全部 @ 引用路径（去重保序） */
export function extractFileReferences(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(FILE_REFERENCE_PATTERN)) {
    const raw = match[1] ?? match[2];
    if (raw === undefined) continue;
    if (match[1] === undefined && !raw.includes(".") && !raw.includes("/") && !/^[A-Z][A-Z0-9_-]+$/u.test(raw)) continue;
    const normalized = raw.replace(/\\/g, "/");
    if (!seen.has(normalized)) seen.add(normalized);
  }
  return [...seen];
}

export function hasFileReferences(text: string): boolean {
  return extractFileReferences(text).length > 0;
}

function truncateContent(content: string): string {
  if (content.length <= FILE_REFERENCE_LIMIT_BYTES) return content;
  return `${content.slice(0, FILE_REFERENCE_LIMIT_BYTES)}\n…[内容已截断：原始 ${content.length} 字节]`;
}

export type FileContentReader = (path: string) => Promise<string | undefined>;

/**
 * 展开消息文本中的 @ 引用：正文原样保留，文件内容以结构化块追加在末尾。
 * 读取失败或不存在于工作区的引用以占位标注，不中断发送。
 */
export async function expandFileReferences(
  text: string,
  readFile: FileContentReader,
): Promise<string> {
  const paths = extractFileReferences(text);
  if (paths.length === 0) return text;

  const blocks = await Promise.all(
    paths.map(async (path) => {
      const content = await readFile(path);
      if (content === undefined || content.length === 0) {
        return `【引用文件 ${path}】\n（无法读取：文件不存在于工作区或读取失败）`;
      }
      return `【引用文件 ${path}】\n\`\`\`\n${truncateContent(content)}\n\`\`\``;
    }),
  );

  return `${text}\n\n${blocks.join("\n\n")}`;
}

/** 桌面端读取器：经工具沙箱 read_file 读取运行所属工作区内的文件（含边界校验），不跟随界面当前项目 */
export function createDesktopFileReader(workspace: string | null): FileContentReader {
  return async (path) => {
    const res = await executeDesktopAgentTool("read_file", { path }, workspace);
    return res.isError ? undefined : res.output;
  };
}
