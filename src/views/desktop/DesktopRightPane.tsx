import {
  Archive,
  Brain,
  Cpu,
  FolderCode,
  Globe,
  LogOut,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
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
  onCompress?: () => void;
  onSelectTab: (tab: DesktopRightTab) => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
  shared: SharedViewProps;
}

export function DesktopRightPane({
  activeTab,
  onClose,
  onCompress,
  onSelectTab,
  onToggleTheme,
  resolvedTheme = "dark",
  shared,
}: DesktopRightPaneProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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

          <button
            type="button"
            className={`desktop-right-pane__tab ${activeTab === "settings" ? "desktop-right-pane__tab--active" : ""}`}
            onClick={() => onSelectTab("settings")}
            title="偏好设置"
          >
            <Settings size={15} />
            <span>设置</span>
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

        {activeTab === "settings" ? (
          <div className="desktop-settings-panel">
            <h3 className="desktop-settings-panel__title">系统设置与偏好</h3>

            {/* 1. 外观与语言 */}
            <div className="desktop-settings-section">
              <h4 className="desktop-settings-section__title">界面与语言</h4>
              <div className="desktop-settings-row">
                <span className="desktop-settings-row__label">
                  {resolvedTheme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
                  <span>主题模式</span>
                </span>
                {onToggleTheme ? (
                  <button
                    type="button"
                    className="desktop-settings-btn"
                    onClick={onToggleTheme}
                  >
                    {resolvedTheme === "dark" ? "切换为浅色" : "切换为深色"}
                  </button>
                ) : null}
              </div>

              <div className="desktop-settings-row">
                <span className="desktop-settings-row__label">
                  <Globe size={15} />
                  <span>界面语言</span>
                </span>
                <button
                  type="button"
                  className="desktop-settings-btn"
                  onClick={() => void shared.onLocale(shared.controller.locale === "zh-CN" ? "ja-JP" : "zh-CN")}
                >
                  {shared.controller.locale === "zh-CN" ? "日本語に切替" : "切换为中文"}
                </button>
              </div>
            </div>

            {/* 2. 对话与上下文 */}
            <div className="desktop-settings-section">
              <h4 className="desktop-settings-section__title">对话优化</h4>
              <div className="desktop-settings-row">
                <span className="desktop-settings-row__label">
                  <Archive size={15} />
                  <span>压缩上下文</span>
                </span>
                {onCompress ? (
                  <button
                    type="button"
                    className="desktop-settings-btn"
                    onClick={onCompress}
                  >
                    {shared.copy.compressContext}
                  </button>
                ) : null}
              </div>
            </div>

            {/* 3. 子配置快捷直达 */}
            <div className="desktop-settings-section">
              <h4 className="desktop-settings-section__title">配置管理</h4>
              <div className="desktop-settings-grid">
                <button
                  type="button"
                  className="desktop-settings-card-btn"
                  onClick={() => onSelectTab("llm")}
                >
                  <Cpu size={16} />
                  <span>模型 (LLM)</span>
                </button>
                <button
                  type="button"
                  className="desktop-settings-card-btn"
                  onClick={() => onSelectTab("skills")}
                >
                  <Sparkles size={16} />
                  <span>技能与联网</span>
                </button>
                <button
                  type="button"
                  className="desktop-settings-card-btn"
                  onClick={() => onSelectTab("memory")}
                >
                  <Brain size={16} />
                  <span>长期记忆</span>
                </button>
                <button
                  type="button"
                  className="desktop-settings-card-btn"
                  onClick={() => onSelectTab("workspace")}
                >
                  <FolderCode size={16} />
                  <span>工作区</span>
                </button>
              </div>
            </div>

            {/* 4. 数据与账号安全 */}
            <div className="desktop-settings-section desktop-settings-section--danger">
              <h4 className="desktop-settings-section__title">数据与安全</h4>
              <div className="desktop-settings-row">
                <span className="desktop-settings-row__label">
                  <Trash2 size={15} />
                  <span>清空本地会话</span>
                </span>
                {showClearConfirm ? (
                  <div className="desktop-settings-confirm">
                    <button
                      type="button"
                      className="desktop-settings-btn desktop-settings-btn--danger"
                      onClick={() => {
                        setShowClearConfirm(false);
                        void shared.onClearData();
                      }}
                    >
                      {shared.copy.confirm}
                    </button>
                    <button
                      type="button"
                      className="desktop-settings-btn"
                      onClick={() => setShowClearConfirm(false)}
                    >
                      {shared.copy.cancel}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="desktop-settings-btn desktop-settings-btn--danger-text"
                    onClick={() => setShowClearConfirm(true)}
                  >
                    {shared.copy.clearData}
                  </button>
                )}
              </div>

              <div className="desktop-settings-row">
                <span className="desktop-settings-row__label">
                  <LogOut size={15} />
                  <span>退出当前登录</span>
                </span>
                <button
                  type="button"
                  className="desktop-settings-btn desktop-settings-btn--danger"
                  onClick={() => void shared.onSignOut()}
                >
                  {shared.copy.signOut}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
