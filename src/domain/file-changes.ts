import type { ChatMessage } from "./chat";

/** 仅从已完成的助手消息中提取成功写入的路径，按首次出现顺序去重。 */
export function collectModifiedFiles(message: ChatMessage): string[] {
  if (message.role !== "assistant" || message.status !== "complete") return [];
  const paths = new Set<string>();
  for (const step of message.toolSteps ?? []) {
    if ((step.name !== "write_file" && step.name !== "edit_file") || !step.result || step.result.isError) continue;
    try {
      const args: unknown = JSON.parse(step.argumentsJson);
      if (!args || typeof args !== "object" || !("path" in args) || typeof args.path !== "string" || !args.path.trim()) continue;
      paths.add(args.path.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, ""));
    } catch {
      // 历史记录中的无效参数不构成可审阅的文件路径。
    }
  }
  return [...paths];
}
