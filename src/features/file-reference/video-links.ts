/** WebView2 / WebKit 能直接播放或常被混用的视频容器；能否解码由播放器自己判断，失败时退回文字 */
const VIDEO_EXTENSION = "(?:mp4|m4v|mov|webm|ogv|mkv)";
// 扩展名后紧跟字母数字或 “.字母” 时说明还没结束（如 a.mp4.txt），句末的句号不算
const EXTENSION_END = "(?![\\w]|\\.\\w)";
const URL_PATTERN = `(?:https?|file):\\/\\/[^\\s)\\]>"'\`]+?\\.${VIDEO_EXTENSION}(?:[?#][^\\s)\\]>"'\`]*)?${EXTENSION_END}`;
const WINDOWS_PATH_PATTERN = `[A-Za-z]:[\\\\/][^\\s"'<>|*?\`)\\]]+?\\.${VIDEO_EXTENSION}${EXTENSION_END}`;
// 前面不能是字母、冒号或斜杠，避免把网址里的路径段、相对路径当成绝对路径
const POSIX_PATH_PATTERN = `(?<![\\w:/.])\\/[^\\s"'<>\`)\\]]+?\\.${VIDEO_EXTENSION}${EXTENSION_END}`;

const INLINE_VIDEO = new RegExp(`\`([^\`\\n]+)\`|${URL_PATTERN}|${WINDOWS_PATH_PATTERN}|${POSIX_PATH_PATTERN}`, "giu");
// 整行只有一个链接时允许本地路径含空格（拖入的附件路径常见 “My Videos” 之类目录）
const SOLE_VIDEO = new RegExp(
  `^(?:${URL_PATTERN}|[A-Za-z]:[\\\\/].*\\.${VIDEO_EXTENSION}|\\/.*\\.${VIDEO_EXTENSION})$`,
  "iu",
);
const VIDEO_FILE = new RegExp(`\\.${VIDEO_EXTENSION}$`, "iu");

export function isVideoPath(path: string): boolean {
  return VIDEO_FILE.test(path);
}

/** 去掉整行外层的 Markdown 链接、反引号、尖括号或引号，剩下的若是视频链接就返回它 */
function soleVideoLink(line: string): string | undefined {
  let value = line.trim();
  const markdownLink = /^!?\[[^\]]*\]\((.+)\)$/u.exec(value);
  if (markdownLink) value = markdownLink[1].trim();
  const wrapped = /^([`<"'])(.+)([`>"'])$/u.exec(value);
  if (wrapped && (wrapped[1] === wrapped[3] || (wrapped[1] === "<" && wrapped[3] === ">"))) value = wrapped[2].trim();
  return SOLE_VIDEO.test(value) ? value : undefined;
}

/**
 * 找出一行文字里的视频链接（远程 http(s)、file:// 与本地绝对路径）。
 * sole 表示整行就是一个链接，此时只渲染播放器，不再重复显示路径文字
 */
export function parseVideoLine(line: string): { links: string[]; sole: boolean } {
  const sole = soleVideoLink(line);
  if (sole !== undefined) return { links: [sole], sole: true };
  const links: string[] = [];
  for (const match of line.matchAll(INLINE_VIDEO)) {
    const link = match[1] === undefined ? match[0] : soleVideoLink(match[1]);
    if (link !== undefined && !links.includes(link)) links.push(link);
  }
  return { links, sole: false };
}

/** 远程链接直接交给 <video>；file:// 与本地路径统一还原成文件系统路径 */
export function localVideoPath(link: string): string | undefined {
  if (/^https?:\/\//iu.test(link)) return undefined;
  if (!/^file:\/\//iu.test(link)) return link;
  try {
    const path = decodeURIComponent(new URL(link).pathname);
    return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path;
  } catch {
    return undefined;
  }
}
