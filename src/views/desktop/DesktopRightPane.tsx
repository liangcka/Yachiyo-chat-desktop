import { Brain, Cpu, FolderCode, Sparkles, X } from "lucide-react";
import { LlmSettingsPanel } from "../../components/LlmSettingsPanel";
import { SkillsPanel } from "../../components/SkillsPanel";
import { UserMemoryPanel } from "../../components/UserMemoryPanel";
import { WorkspacePanel } from "../../components/desktop/WorkspacePanel";
import { SKILLS } from "../../skills";
import type { SharedViewProps } from "../layout-types";
import type { DesktopRightTab } from "./DesktopSidebar";

export interface DesktopRightPaneProps {
  activeTab: DesktopRightTab;
  onClose: () => void;
  onSelectTab: (tab: DesktopRightTab) => void;
  shared: SharedViewProps;
}

export function DesktopRightPane({
  activeTab,
  onClose,
  onSelectTab,
  shared,
}: DesktopRightPaneProps) {
  if (activeTab === "none") return null;

  return (
    <aside className="desktop-right-pane" aria-label="桌面多功能工具面板">
      {/* 顶部标签切换与关闭 */}
      <div className="desktop-right-pane__header">
        <div className="desktop-right-pane__tabs">
          <button
            type="button"
            className={`desktop-right-pane__tab ${activeTab === "workspace" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("workspace")}
            title="工作区与终端"
          >
            <FolderCode size={15} />
            <span>工作区</span>
          </button>

          <button
            type="button"
            className={`desktop-right-pane__tab ${activeTab === "llm" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("llm")}
            title="模型设置"
          >
            <Cpu size={15} />
            <span>LLM</span>
          </button>

          <button
            type="button"
            className={`desktop-right-pane__tab ${activeTab === "skills" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("skills")}
            title="技能配置"
          >
            <Sparkles size={15} />
            <span>技能</span>
          </button>

          <button
            type="button"
            className={`desktop-right-pane__tab ${activeTab === "memory" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("memory")}
            title="长期记忆"
          >
            <Brain size={15} />
            <span>记忆</span>
          </button>
        </div>

        <button
          type="button"
          className="desktop-right-pane__close-btn"
          onClick={onClose}
          title="关闭右侧面板 (Esc / Ctrl+B)"
        >
          <X size={16} />
        </button>
      </div>

      {/* 面板内容容器 */}
      <div className="desktop-right-pane__body">
        {activeTab === "workspace" ? (
          <WorkspacePanel copy={shared.copy} open={true} onClose={onClose} />
        ) : null}

        {activeTab === "llm" ? (
          <LlmSettingsPanel
            activeProvider={shared.llmActiveProvider}
            copy={shared.copy}
            entries={shared.llmEntries}
            onActivate={shared.onLlmActivate}
            onClear={shared.onLlmClear}
            onClose={onClose}
            onSave={shared.onLlmSave}
            open={true}
          />
        ) : null}

        {activeTab === "skills" ? (
          <SkillsPanel
            activeIds={shared.activeSkillIds}
            copy={shared.copy}
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
