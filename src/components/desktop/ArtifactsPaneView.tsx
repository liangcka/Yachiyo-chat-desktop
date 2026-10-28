import { useState } from "react";
import { useLocale } from "../../i18n/locale-context";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Eye,
  FileCode,
  GitCompareArrows,
  Image as ImageIcon,
  Layers,
  Loader2,
  Terminal,
  XCircle,
} from "lucide-react";
import type { ChatMessage, ToolStep } from "../../domain/chat";
import { projectToolStep, type ToolProjection } from "../../domain/tool-projection";
import { ImageLightbox } from "../chat/ImageLightbox";
import type { ReviewTarget } from "../chat/review-context";
import { commandStatusLabel } from "../tools/command-status";

export interface ArtifactsPaneViewProps {
  messages: ReadonlyArray<ChatMessage>;
  imageUrls: ReadonlyMap<string, string>;
  /** 打开审阅；文件改动来自绑定项目的运行时带上该运行，直接审阅它的改动 */
  onOpenReview?: (target?: ReviewTarget) => void;
  onOpenFile?: (path: string) => void;
}

function StatusIcon({ projection, ja }: { projection: ToolProjection; ja: boolean }) {
  switch (projection.status) {
    case "succeeded":
      return <CheckCircle2 size={12} className="artifact-card__status-icon artifact-card__status-icon--success" aria-label={ja ? "成功" : "成功"} />;
    case "failed":
      return <XCircle size={12} className="artifact-card__status-icon artifact-card__status-icon--error" aria-label={ja ? "失敗" : "失败"} />;
    case "running":
      return <Loader2 size={12} className="artifact-card__status-icon artifact-card__status-icon--running" aria-label={ja ? "実行中" : "运行中"} />;
    case "cancelled":
    case "unknown":
      return (
        <AlertTriangle
          size={12}
          className="artifact-card__status-icon artifact-card__status-icon--warning"
          aria-label={projection.status === "cancelled" ? (ja ? "停止済み" : "已停止") : ja ? "結果不明" : "结果未知"}
        />
      );
  }
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
  projection?: ToolProjection;
  reviewTarget?: ReviewTarget;
}

export function ArtifactsPaneView({
  messages,
  imageUrls,
  onOpenReview,
  onOpenFile,
}: ArtifactsPaneViewProps) {
  const ja = useLocale() === "ja-JP";
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 从会话历史中提取所有产物与工具工件
  const artifacts: ExtractedArtifact[] = [];

  messages.forEach((msg) => {
    // 1. 图片产物
    if (msg.imageId && imageUrls.has(msg.imageId)) {
      artifacts.push({
        id: `img-${msg.id}`,
        type: "image",
        title: ja ? "画像" : "多模态视觉图像",
        subtitle:
          msg.role === "user"
            ? ja ? "ユーザーの添付画像" : "用户输入附件"
            : ja ? "AI の生成・認識結果" : "AI 生成/识别结果",
        timestamp: msg.createdAt,
        imageUrl: imageUrls.get(msg.imageId),
      });
    }

    // 2. 工具调用工件：统一投影只认网关实际提供的工具（write_file / edit_file / run_command）
    const settled = msg.status !== "streaming";
    const reviewTarget = msg.run !== undefined && msg.run.workspace !== null ? { runId: msg.run.id, workspace: msg.run.workspace } : undefined;
    for (const step of msg.toolSteps ?? []) {
      const projection = projectToolStep(step, settled);
      if (projection.kind === "file_write") {
        artifacts.push({
          id: `step-${step.id}`,
          type: "code_step",
          title: step.name === "write_file" ? (ja ? "ファイルの作成／書き換え" : "新建/重写文件") : ja ? "ファイルを編集" : "编辑文件",
          ...(projection.path !== undefined ? { subtitle: projection.path, filePath: projection.path } : {}),
          step,
          projection,
          ...(reviewTarget !== undefined ? { reviewTarget } : {}),
        });
      } else if (projection.kind === "command") {
        artifacts.push({
          id: `step-${step.id}`,
          type: "command_step",
          title: ja ? "ターミナルコマンドの実行" : "终端指令执行",
          subtitle: `$ ${projection.command ?? ""}`,
          step,
          projection,
        });
      }
    }
  });

  return (
    <div className="artifacts-pane" aria-label={ja ? "成果物の一覧" : "成果与工件展示区"}>
      {/* 顶部统计栏 */}
      <div className="artifacts-pane__meta-bar">
        <div className="artifacts-pane__meta-left">
          <Layers size={14} className="artifacts-pane__meta-icon" />
          <span className="artifacts-pane__meta-title">{ja ? "成果物と実行ステップ" : "产出工件与活动步骤"}</span>
          <span className="artifacts-pane__count-text">（{artifacts.length}）</span>
        </div>
        {onOpenReview ? (
          <button
            type="button"
            className="artifacts-pane__quick-diff-btn"
            onClick={() => onOpenReview()}
            title={ja ? "現在のワークスペースのコード差分をレビュー" : "查看当前工作区代码差异审阅"}
          >
            <GitCompareArrows size={13} />
            <span>{ja ? "差分レビュー" : "差异审阅"}</span>
          </button>
        ) : null}
      </div>

      {artifacts.length === 0 ? (
        <div className="artifacts-pane__empty">
          <div className="artifacts-pane__empty-icon-halo">
            <Layers size={28} />
          </div>
          <h4 className="artifacts-pane__empty-title">{ja ? "成果物はまだありません" : "暂无生成产物"}</h4>
          <p className="artifacts-pane__empty-desc">
            {ja
              ? "会話の中で画像の生成、コードファイルの変更、ターミナルコマンドの実行が行われると、結果カードがここに表示されます。"
              : "当 AI 在对话中生成图片、修改代码文件或执行终端命令时，对应的结果卡片将实时呈现在这里。"}
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
                    aria-label={ja ? "画像を全体表示" : "查看图片全图"}
                  >
                    <img src={art.imageUrl} alt={art.title} className="artifact-card__img" />
                    <div className="artifact-card__image-overlay">
                      <Eye size={16} />
                      <span>{ja ? "全体を表示" : "查看全图"}</span>
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
              return (
                <div key={art.id} className="artifact-card artifact-card--code">
                  <div className="artifact-card__body">
                    <div className="artifact-card__header">
                      <FileCode size={13} className="artifact-card__type-icon artifact-card__type-icon--code" />
                      <span className="artifact-card__title">{art.title}</span>
                      {art.projection !== undefined ? <StatusIcon projection={art.projection} ja={ja} /> : null}
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
                        <span>{ja ? "エディターで開く" : "在编辑器打开"}</span>
                      </button>
                    ) : null}
                    {onOpenReview ? (
                      <button
                        type="button"
                        className="artifact-card__action-btn"
                        onClick={() => onOpenReview(art.reviewTarget)}
                      >
                        <GitCompareArrows size={12} />
                        <span>{ja ? "変更を見る" : "查看改动"}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (art.type === "command_step") {
              const status = art.projection?.record !== undefined ? commandStatusLabel(art.projection.record, ja ? "ja-JP" : "zh-CN") : undefined;
              return (
                <div key={art.id} className="artifact-card artifact-card--command">
                  <div className="artifact-card__body">
                    <div className="artifact-card__header">
                      <Terminal size={13} className="artifact-card__type-icon artifact-card__type-icon--terminal" />
                      <span className="artifact-card__title">{art.title}</span>
                      {art.projection !== undefined ? <StatusIcon projection={art.projection} ja={ja} /> : null}
                    </div>
                    <code className="artifact-card__cmd-line">{art.subtitle}</code>
                    {status !== undefined ? <span className={`artifact-card__status-text artifact-card__status-text--${status.tone}`}>{status.text}</span> : null}
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

      {previewImage ? <ImageLightbox src={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </div>
  );
}
