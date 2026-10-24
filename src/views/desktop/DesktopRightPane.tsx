import {
  FolderCode,
  GitCompareArrows,
  Layers,
  RefreshCw,
  X,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { EditorWorkspaceController } from "../../app/use-editor-workspace";
import { ArtifactsPaneView } from "../../components/desktop/ArtifactsPaneView";
import { LlmSettingsPanel } from "../../components/LlmSettingsPanel";

const DiffReviewPanel = lazy(() =>
  import("../../components/editor/DiffReviewPanel").then((m) => ({ default: m.DiffReviewPanel })),
);
import { SkillsPanel } from "../../components/SkillsPanel";
import { UserMemoryPanel } from "../../components/UserMemoryPanel";
import { WorkspacePanel } from "../../components/desktop/WorkspacePanel";
import type { SettingsTabKey } from "../../components/settings/SettingsModal";
import { SKILLS } from "../../skills";
import type { SharedViewProps } from "../layout-types";
import type { DesktopRightTab } from "./sidebar/types";

export interface DesktopRightPaneProps {
  activeTab: DesktopRightTab;
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
  resolvedTheme = "dark",
}: DesktopRightPaneProps) {
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const ja = shared.controller.locale === "ja-JP";

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
        {/* 1. 代码差异审阅 Tab */}
        {activeTab === "review" ? (
          <Suspense fallback={<div className="desktop-right-pane__loading" />}>
            <DiffReviewPanel copy={shared.copy} resolvedTheme={resolvedTheme} refreshKey={reviewRefreshKey} />
          </Suspense>
        ) : null}

        {/* 3. 成果工件 Tab */}
        {activeTab === "artifacts" ? (
          <ArtifactsPaneView
            messages={shared.controller.messages}
            imageUrls={shared.imageUrls}
            onOpenReview={onOpenReview ?? (() => onSelectTab("review"))}
            onOpenFile={onOpenFile}
          />
        ) : null}

        {/* 4. 工作区与终端 Tab */}
        {visibleTab === "workspace" ? (
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
