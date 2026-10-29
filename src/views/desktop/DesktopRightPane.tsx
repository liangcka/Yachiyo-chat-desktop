import {
  FolderCode,
  GitCompareArrows,
  Layers,
  RefreshCw,
  X,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { EditorWorkspaceController } from "../../app/use-editor-workspace";
import { ArtifactsPaneView } from "../../components/desktop/ArtifactsPaneView";
import { LlmSettingsPanel } from "../../components/LlmSettingsPanel";

const DiffReviewPanel = lazy(() =>
  import("../../components/editor/DiffReviewPanel").then((m) => ({ default: m.DiffReviewPanel })),
);
const TaskReviewPanel = lazy(() =>
  import("../../components/editor/TaskReviewPanel").then((m) => ({ default: m.TaskReviewPanel })),
);
import type { ReviewTarget } from "../../components/chat/review-context";
import { reviewableRuns } from "../../domain/file-changes";
import { SkillsPanel } from "../../components/SkillsPanel";
import { UserMemoryPanel } from "../../components/UserMemoryPanel";
import { WorkspacePanel } from "../../components/desktop/WorkspacePanel";
import type { SettingsTabKey } from "../../components/settings/SettingsModal";
import { SKILLS } from "../../skills";
import type { SharedViewProps } from "../layout-types";
import type { DesktopRightTab } from "./sidebar/types";
import { useProjectState } from "../../services/project-manager";
import { isDesktopApp } from "../../services/app-platform";

/** 一次打开审阅的请求；nonce 变化即视为新请求（重复点击同一任务也会切回“本次任务”） */
export interface ReviewRequest {
  readonly nonce: number;
  readonly target?: ReviewTarget;
}

export interface DesktopRightPaneProps {
  activeTab: DesktopRightTab;
  reviewRequest?: ReviewRequest;
  onClose: () => void;
  /** 文件树点击文件：在编辑器中打开 */
  onOpenFile?: (path: string) => void;
  onOpenReview?: () => void;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onReferenceFile?: (path: string) => void;
  onCheckpointRestored?: () => void;
  onSelectTab: (tab: DesktopRightTab) => void;
  shared: SharedViewProps;
  editorWorkspace?: EditorWorkspaceController;
  resolvedTheme?: "light" | "dark";
}

export function DesktopRightPane({
  activeTab,
  onClose,
  onOpenFile,
  onOpenReview,
  onReferenceFile,
  onCheckpointRestored,
  onSelectTab,
  shared,
  reviewRequest,
  resolvedTheme = "dark",
}: DesktopRightPaneProps) {
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const { activeProject } = useProjectState();
  const ja = shared.controller.locale === "ja-JP";
  const runs = useMemo(() => reviewableRuns(shared.controller.messages), [shared.controller.messages]);
  const [reviewMode, setReviewMode] = useState<"task" | "git">("task");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(reviewRequest?.target?.runId ?? null);
  // 新的打开请求切回“本次任务”并选中请求的运行（渲染期调整，不经过 effect）
  const [handledRequest, setHandledRequest] = useState(reviewRequest?.nonce);
  if (reviewRequest !== undefined && reviewRequest.nonce !== handledRequest) {
    setHandledRequest(reviewRequest.nonce);
    setReviewMode("task");
    if (reviewRequest.target !== undefined) setSelectedRunId(reviewRequest.target.runId);
  }
  /** 面板内（成果工件）打开审阅：带运行时直接选中该运行 */
  const openReviewInPane = (target?: ReviewTarget) => {
    if (target !== undefined) setSelectedRunId(target.runId);
    setReviewMode("task");
    onSelectTab("review");
  };
  // 选中的运行不在当前会话（例如切换了会话）时回到最近一次运行
  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? runs[0];
  const showTask = reviewMode === "task" && selectedRun !== undefined;

  if (activeTab === "none") return null;
  const visibleTab = activeTab === "editor" ? "workspace" : activeTab;

  return (
    <aside className="desktop-right-pane" aria-label={ja ? "成果とレビューのパネル" : "成果与多功能审阅面板"}>
      {/* 顶部标签切换与关闭 */}
      <div className="desktop-right-pane__header">
        <div className="desktop-right-pane__tabs" role="tablist" aria-label={ja ? "成果とレビューのタブ" : "成果与审阅标签"}>
          {/* 1. 代码差异审阅 (Codex 式 Hunk 审阅) */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "review"}
            className={`desktop-right-pane__tab ${activeTab === "review" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("review")}
            title={ja ? "コード差分のブロック単位レビュー (Codex Review)" : "代码差异与逐块审阅 (Codex Review)"}
          >
            <GitCompareArrows size={14} />
            <span>{ja ? "コードレビュー" : "代码审阅"}</span>
          </button>

          {/* 3. 产物工件画廊 */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "artifacts"}
            className={`desktop-right-pane__tab ${activeTab === "artifacts" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("artifacts")}
            title={ja ? "生成された成果物と実行ステップ" : "多模态生成产物与活动步骤"}
          >
            <Layers size={14} />
            <span>{ja ? "成果物" : "成果工件"}</span>
          </button>

          {/* 4. 工作区与终端 */}
          <button
            type="button"
            role="tab"
            aria-selected={visibleTab === "workspace"}
            className={`desktop-right-pane__tab ${visibleTab === "workspace" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("workspace")}
            title={ja ? "ワークスペースのファイルツリーとターミナル" : "工作区文件树与快捷终端"}
          >
            <FolderCode size={14} />
            <span>{ja ? "ワークスペース" : "工作区"}</span>
          </button>
        </div>

        <div className="desktop-right-pane__actions">
          {activeTab === "review" ? (
            <button
              type="button"
              className="desktop-right-pane__action-btn"
              onClick={() => setReviewRefreshKey((k) => k + 1)}
              title={shared.copy.refreshFileTree}
              aria-label={shared.copy.refreshFileTree}
            >
              <RefreshCw size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="desktop-right-pane__close-btn"
            onClick={onClose}
            title={ja ? "右側のパネルを閉じる (Ctrl+B / Esc)" : "关闭右侧面板 (Ctrl+B / Esc)"}
            aria-label={ja ? "成果パネルを閉じる" : "关闭成果面板"}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 面板内容容器 */}
      <div className="desktop-right-pane__body">
        {/* 1. 代码审阅 Tab：本次任务改动（可保留/撤销） / 工作区相对 HEAD 的差异（只读） */}
        {(activeTab === "review" || visibleTab === "workspace") && !isDesktopApp() ? (
          <p className="desktop-composer-capability desktop-right-pane__capability" role="note">{shared.copy.webCapabilityNote}</p>
        ) : activeTab === "review" ? (
          <div className="desktop-right-pane__review">
            <div className="review-switch">
              <div className="review-panel__modes" role="tablist" aria-label={shared.copy.reviewTitle}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={showTask}
                  disabled={selectedRun === undefined}
                  title={selectedRun === undefined ? shared.copy.reviewNoRun : undefined}
                  className={`review-mode-btn ${showTask ? "review-mode-btn--active" : ""}`}
                  onClick={() => setReviewMode("task")}
                >
                  {shared.copy.reviewTaskTab}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!showTask}
                  className={`review-mode-btn ${!showTask ? "review-mode-btn--active" : ""}`}
                  onClick={() => setReviewMode("git")}
                >
                  {shared.copy.reviewGitTab}
                </button>
              </div>
              {showTask && runs.length > 1 ? (
                <select
                  className="review-switch__runs"
                  aria-label={ja ? "レビューするタスク" : "要审阅的任务"}
                  value={selectedRun.runId}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                >
                  {runs.map((run) => (
                    <option key={run.runId} value={run.runId}>
                      {new Date(run.startedAt).toLocaleTimeString(ja ? "ja-JP" : "zh-CN", { hour: "2-digit", minute: "2-digit" })} · {run.request || run.runId.slice(0, 8)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {showTask && selectedRun.workspace !== activeProject ? (
              <p className="review-switch__workspace">
                {ja ? `このタスクのプロジェクト：${selectedRun.workspace}` : `该任务所属项目：${selectedRun.workspace}`}
              </p>
            ) : null}
            <Suspense fallback={<div className="desktop-right-pane__loading" />}>
              {showTask ? (
                <TaskReviewPanel
                  key={`${selectedRun.workspace}\u0000${selectedRun.runId}`}
                  workspace={selectedRun.workspace}
                  runId={selectedRun.runId}
                  refreshKey={reviewRefreshKey}
                />
              ) : activeProject !== null ? (
                <DiffReviewPanel
                  key={activeProject}
                  workspace={activeProject}
                  copy={shared.copy}
                  resolvedTheme={resolvedTheme}
                  refreshKey={reviewRefreshKey}
                />
              ) : (
                <p className="review-files__hint">{shared.copy.noProjectSelected}</p>
              )}
            </Suspense>
          </div>
        ) : null}

        {/* 3. 成果工件 Tab */}
        {activeTab === "artifacts" ? (
          <ArtifactsPaneView
            messages={shared.controller.messages}
            imageUrls={shared.imageUrls}
            onOpenReview={openReviewInPane}
            onOpenFile={onOpenFile}
          />
        ) : null}

        {/* 4. 工作区与终端 Tab */}
        {visibleTab === "workspace" && isDesktopApp() ? (
          <WorkspacePanel
            copy={shared.copy}
            open={true}
            onClose={onClose}
            onOpenFile={onOpenFile}
            onOpenReview={onOpenReview ?? (() => onSelectTab("review"))}
            onReferenceFile={onReferenceFile}
            isAgentRunning={shared.controller.phase === "streaming" || shared.controller.phase === "loading"}
            onCheckpointRestored={onCheckpointRestored}
          />
        ) : null}

        {/* 兼容旧版 Tab 映射 */}
        {activeTab === "llm" ? (
          <LlmSettingsPanel
            activeEntryId={shared.llmActiveEntryId}
            copy={shared.copy}
            entries={shared.llmEntries}
            onActivate={shared.onLlmActivate}
            onClear={shared.onLlmClear}
            onClose={onClose}
            onSave={shared.onLlmSave}
            onSetEnabled={shared.onLlmSetEnabled}
            onTestConnection={shared.onLlmTestConnection}
            open={true}
          />
        ) : null}

        {activeTab === "skills" ? (
          <SkillsPanel
            activeIds={shared.activeSkillIds}
            copy={shared.copy}
            embedded={true}
            onClose={onClose}
            onToggle={(id, next) => void shared.onSkillToggle(id, next)}
            onWebSearchSettingsChange={shared.onWebSearchSettingsChange}
            open={true}
            skills={SKILLS}
            webSearchSettings={shared.webSearchSettings}
          />
        ) : null}

        {activeTab === "memory" ? (
          <UserMemoryPanel
            copy={shared.copy}
            embedded={true}
            memory={shared.controller.userMemory ?? ""}
            onClose={onClose}
            onSave={async (memory) => {
              const saved = await shared.controller.updateUserMemory(memory);
              if (saved) {
                shared.showToast(shared.copy.userMemorySaved, "info");
                onClose();
              } else {
                shared.showToast(shared.copy.userMemorySaveFailed, "error");
              }
              return saved;
            }}
            open={true}
          />
        ) : null}
      </div>
    </aside>
  );
}
