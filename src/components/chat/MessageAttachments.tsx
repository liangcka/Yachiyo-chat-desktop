import { ChevronRight, FileText } from "lucide-react";
import type { ComposerAttachment, TextAttachment } from "../../features/file-reference/attachments";
import { ChatVideo } from "./ChatVideo";

function FileAttachmentCard({ file }: { file: TextAttachment }) {
  const lines = file.content === "" ? 0 : file.content.split("\n").length;
  return (
    <details className="message-attachment">
      <summary className="message-attachment__summary">
        <FileText size={16} aria-hidden="true" className="message-attachment__icon" />
        <span className="message-attachment__name">{file.name}</span>
        <span className="message-attachment__meta">{lines} 行</span>
        <ChevronRight size={13} aria-hidden="true" className="message-attachment__chevron" />
      </summary>
      <pre className="message-attachment__content">{file.content}</pre>
    </details>
  );
}

/** 用户消息里随发的文件与视频，和图片一样独立成卡片排在文字气泡之外 */
export function MessageAttachments({ attachments }: { attachments: ReadonlyArray<ComposerAttachment> }) {
  return (
    <>
      {attachments.map((file, index) => "kind" in file
        ? <ChatVideo key={`${index}-${file.path}`} link={file.path} />
        : <FileAttachmentCard key={`${index}-${file.name}`} file={file} />)}
    </>
  );
}
