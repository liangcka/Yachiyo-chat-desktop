import { useState } from "react";
import {
  CheckCircle2,
  Code2,
  Eye,
  FileCode,
  GitCompareArrows,
  Image as ImageIcon,
  Layers,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import type { ChatMessage, ToolStep } from "../../domain/chat";

export interface ArtifactsPaneViewProps {
  messages: ReadonlyArray<ChatMessage>;
  imageUrls: ReadonlyMap<string, string>;
  onOpenReview?: () => void;
  onOpenFile?: (path: string) => void;
}

interface ExtractedArtifact {
  id: string;
  type: "image" | "code_step" | "command_step";
  title: string;
  subtitle?: string;
  timestamp?: number;
  imageUrl?: string;
  codeSnippet?: string;
  filePath?: string;
  step?: ToolStep;
}

export function ArtifactsPaneView({
  messages,
  imageUrls,
  onOpenReview,
  onOpenFile,
}: ArtifactsPaneViewProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 从会话历史中提取所有产物与工具工件
  const artifacts: ExtractedArtifact[] = [];

  messages.forEach((msg) => {
    // 1. 图片产物
    if (msg.imageId && imageUrls.has(msg.imageId)) {
      artifacts.push({
        id: `img-${msg.id}`,
        type: "image",
        title: "多模态视觉图像",
        subtitle: msg.role === "user" ? "用户输入附件" : "AI 生成/识别结果",
        timestamp: msg.createdAt,
        imageUrl: imageUrls.get(msg.imageId),
      });
    }

    // 2. 工具调用工件（写代码、跑命令、文件操作）
    if (msg.toolSteps && msg.toolSteps.length > 0) {
      msg.toolSteps.forEach((step) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(step.argumentsJson) as Record<string, unknown>;
        } catch {
          // 容错
        }

        if (step.name === "write_file" || step.name === "replace_file_content") {
          const filePath = String(parsedArgs.path || parsedArgs.TargetFile || parsedArgs.file || "workspace-file");
          artifacts.push({
            id: `step-${step.id}`,
            type: "code_step",
            title: step.name === "write_file" ? "新建/重写文件" : "更新文件代码",
            subtitle: filePath,
            filePath,
            step,
          });
        } else if (step.name === "run_command" || step.name === "terminal") {
          const command = String(parsedArgs.command || parsedArgs.cmd || "");
          artifacts.push({
            id: `step-${step.id}`,
            type: "command_step",
            title: "终端指令执行",
            subtitle: `$ ${command}`,
            step,
          });
        }
      });
    }
  });

  return (
    <div className="artifacts-pane" aria-label="成果与工件展示区">
      {/* 顶部统计栏 */}
      <div className="artifacts-pane__meta-bar">
        <div className="artifacts-pane__meta-left">
          <Layers size={14} className="artifacts-pane__meta-icon" />
          <span className="artifacts-pane__meta-title">产出工件与活动步骤</span>
          <span className="artifacts-pane__count-text">（{artifacts.length}）</span>
        </div>
        {onOpenReview ? (
          <button
            type="button"
            className="artifacts-pane__quick-diff-btn"
            onClick={onOpenReview}
            title="查看当前工作区代码差异审阅"
          >
            <GitCompareArrows size={13} />
            <span>差异审阅</span>
          </button>
        ) : null}
      </div>

      {artifacts.length === 0 ? (
        <div className="artifacts-pane__empty">
          <div className="artifacts-pane__empty-icon-halo">
            <Layers size={28} />
          </div>
          <h4 className="artifacts-pane__empty-title">暂无生成产物</h4>
          <p className="artifacts-pane__empty-desc">
            当 AI 在对话中生成图片、修改代码文件或执行终端命令时，对应的结果卡片将实时呈现在这里。
          </p>
        </div>
      ) : (
        <div className="artifacts-pane__list">
          {artifacts.map((art) => {
            if (art.type === "image" && art.imageUrl) {
              return (
                <div key={art.id} className="artifact-card artifact-card--image">
                  <button
                    type="button"
                    className="artifact-card__image-wrap"
                    onClick={() => setPreviewImage(art.imageUrl!)}
                    aria-label="查看图片全图"
                  >
                    <img src={art.imageUrl} alt={art.title} className="artifact-card__img" />
                    <div className="artifact-card__image-overlay">
                      <Eye size={16} />
                      <span>查看全图</span>
                    </div>
                  </button>
                  <div className="artifact-card__body">
                    <div className="artifact-card__header">
                      <ImageIcon size={13} className="artifact-card__type-icon" />
                      <span className="artifact-card__title">{art.title}</span>
                    </div>
                    {art.subtitle ? (
                      <span className="artifact-card__subtitle">{art.subtitle}</span>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (art.type === "code_step") {
              const isError = art.step?.result?.isError;
              return (
                <div key={art.id} className="artifact-card artifact-card--code">
                  <div className="artifact-card__body">
                    <div className="artifact-card__header">
                      <FileCode size={13} className="artifact-card__type-icon artifact-card__type-icon--code" />
                      <span className="artifact-card__title">{art.title}</span>
                      {art.step?.result ? (
                        isError ? (
                          <XCircle size={12} className="artifact-card__status-icon artifact-card__status-icon--error" />
                        ) : (
                          <CheckCircle2 size={12} className="artifact-card__status-icon artifact-card__status-icon--success" />
                        )
                      ) : null}
                    </div>
                    <code className="artifact-card__filepath" title={art.filePath}>
                      {art.subtitle}
                    </code>
                    {art.step?.result?.output ? (
                      <pre className="artifact-card__log">{art.step.result.output.slice(0, 300)}</pre>
                    ) : null}
                  </div>
                  <div className="artifact-card__actions">
                    {art.filePath && onOpenFile ? (
                      <button
                        type="button"
                        className="artifact-card__action-btn"
                        onClick={() => onOpenFile(art.filePath!)}
                      >
                        <Code2 size={12} />
                        <span>在编辑器打开</span>
                      </button>
                    ) : null}
                    {onOpenReview ? (
                      <button
                        type="button"
                        className="artifact-card__action-btn"
                        onClick={onOpenReview}
                      >
                        <GitCompareArrows size={12} />
                        <span>查看改动</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (art.type === "command_step") {
              const isError = art.step?.result?.isError;
              return (
                <div key={art.id} className="artifact-card artifact-card--command">
                  <div className="artifact-card__body">
                    <div className="artifact-card__header">
                      <Terminal size={13} className="artifact-card__type-icon artifact-card__type-icon--terminal" />
                      <span className="artifact-card__title">{art.title}</span>
                      {art.step?.result ? (
                        isError ? (
                          <XCircle size={12} className="artifact-card__status-icon artifact-card__status-icon--error" />
                        ) : (
                          <CheckCircle2 size={12} className="artifact-card__status-icon artifact-card__status-icon--success" />
                        )
                      ) : null}
                    </div>
                    <code className="artifact-card__cmd-line">{art.subtitle}</code>
                    {art.step?.result?.output ? (
                      <pre className="artifact-card__log">{art.step.result.output.slice(0, 300)}</pre>
                    ) : null}
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* 图像大图灯箱预览 */}
      {previewImage ? (
        <div
          className="artifact-lightbox"
          role="dialog"
          aria-label="图像全屏预览"
          aria-modal="true"
        >
          <button
            type="button"
            className="artifact-lightbox__backdrop"
            onClick={() => setPreviewImage(null)}
            aria-label="关闭全屏预览"
            tabIndex={-1}
          />
          <div className="artifact-lightbox__inner">
            <img src={previewImage} alt="预览图片" className="artifact-lightbox__img" />
            <button
              type="button"
              className="artifact-lightbox__close"
              onClick={() => setPreviewImage(null)}
              title="关闭预览 (Esc)"
              aria-label="关闭全屏预览"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
