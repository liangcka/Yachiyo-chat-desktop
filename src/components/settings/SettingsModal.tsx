import {
  Camera,
  Check,
  Cpu,
  Database,
  Folder,
  FolderPlus,
  FolderX,
  Globe,
  HelpCircle,
  Keyboard,
  Palette,
  Play,
  Sliders,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LlmSettingsPanel } from "../LlmSettingsPanel";
import { SkillsPanel } from "../SkillsPanel";
import { UserMemoryPanel } from "../UserMemoryPanel";
import { WorkspacePanel } from "../desktop/WorkspacePanel";
import { SKILLS } from "../../skills";
import { PROVIDER_METADATA } from "../../domain/llm";
import {
  getProjectDisplayName,
  projectManager,
  useProjectState,
} from "../../services/project-manager";
import {
  PRESET_USER_BADGES,
  useLocalUserSettings,
} from "../../services/user-settings";
import { AvatarCropModal } from "./AvatarCropModal";
import { openExternalUrl } from "../../services/desktop-bridge";
import type { SharedViewProps } from "../../views/layout-types";

export type SettingsTabKey =
  | "general"
  | "app"
  | "appearance"
  | "models"
  | "custom"
  | "browser"
  | "project"
  | "shortcuts"
  | "user";

export interface SettingsModalProps {
  initialTab?: SettingsTabKey;
  onClose: () => void;
  onCompress?: () => void;
  onToggleTheme?: () => void;
  open: boolean;
  resolvedTheme?: "light" | "dark";
  shared: SharedViewProps;
}

const STORAGE_PRIVACY_MODE = "yachiyo-settings-privacy-mode";

export function SettingsModal({
  initialTab = "general",
  onClose,
  onCompress,
  onToggleTheme,
  open,
  resolvedTheme = "dark",
  shared,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedRule, setCopiedRule] = useState(false);
  const [showDetachConfirm, setShowDetachConfirm] = useState(false);
  const [showWorkspaceTerminal, setShowWorkspaceTerminal] = useState(false);

  // 本地用户设置（纯本地 LocalStorage）
  const [userSettings, saveUserSettings] = useLocalUserSettings();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [usernameDraft, setUsernameDraft] = useState(userSettings.username);
  const [usernameSavedToast, setUsernameSavedToast] = useState(false);
  const [prevUsername, setPrevUsername] = useState(userSettings.username);
  if (userSettings.username !== prevUsername) {
    setPrevUsername(userSettings.username);
    setUsernameDraft(userSettings.username);
  }

  const handleSaveUsername = () => {
    const trimmed = usernameDraft.trim();
    saveUserSettings({ username: trimmed });
    setUsernameDraft(trimmed || "酒寄彩叶");
    setUsernameSavedToast(true);
    shared.showToast(
      trimmed ? `用户名已更新为「${trimmed}」（本地保存）` : "用户名已恢复默认（酒寄彩叶）",
      "info",
    );
    setTimeout(() => setUsernameSavedToast(false), 2000);
  };

  // 称号设置状态与实时同步
  const [badgeDraft, setBadgeDraft] = useState(userSettings.badge || "Lite");
  const [prevBadge, setPrevBadge] = useState(userSettings.badge || "Lite");
  if ((userSettings.badge || "Lite") !== prevBadge) {
    setPrevBadge(userSettings.badge || "Lite");
    setBadgeDraft(userSettings.badge || "Lite");
  }

  const handleSaveBadge = (newBadge: string) => {
    const trimmed = newBadge.trim();
    const finalBadge = trimmed ? trimmed.slice(0, 10) : "Lite";
    saveUserSettings({ badge: finalBadge });
    setBadgeDraft(finalBadge);
    shared.showToast(`身份称号已更新为「${finalBadge}」（本地保存）`, "info");
  };

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [rawAvatarSrc, setRawAvatarSrc] = useState<string>("");

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      shared.showToast("请选择图片格式文件", "error");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawAvatarSrc(reader.result as string);
      setCropModalOpen(true);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    };
    reader.onerror = () => {
      shared.showToast("读取图片文件失败", "error");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmCropAvatar = (croppedDataUrl: string) => {
    setCropModalOpen(false);
    setRawAvatarSrc("");
    saveUserSettings({ avatar: croppedDataUrl });
    shared.showToast("头像已裁剪并保存至本地", "info");
  };

  const handleRemoveAvatar = () => {
    saveUserSettings({ avatar: "" });
    shared.showToast("已恢复默认头像", "info");
  };

  // 接入全局真实项目状态
  const { activeProject, recentProjects } = useProjectState();

  // 隐私模式持久化
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PRIVACY_MODE);
      return stored !== "false";
    } catch {
      return true;
    }
  });

  const handleTogglePrivacyMode = () => {
    setPrivacyMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_PRIVACY_MODE, String(next));
      } catch {
        /* ignore storage failure */
      }
      return next;
    });
  };

  const handleCopyPath = async (path: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
      }
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleCopyRuleContract = async () => {
    const contract = `# Yachiyo Chat 权威 Agent 运行守则\n1. 遵守工作区边界与文件读写隔离\n2. 先读后改，防御性写入\n3. 终端命令沙盒化执行与质量门禁自动闭环`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contract);
      }
      setCopiedRule(true);
      setTimeout(() => setCopiedRule(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handlePickWorkspace = async () => {
    const picked = await projectManager.pickAndOpenProject("选择工作区目录");
    if (picked) {
      setActiveTab("project");
      shared.showToast(`已切换工作区至 ${getProjectDisplayName(picked)}`, "info");
    }
  };

  const handleQuickStartWorkspace = async () => {
    const picked = await projectManager.quickStart();
    if (picked) {
      setActiveTab("project");
      shared.showToast("已通过快速开始进入工作区", "info");
    }
  };

  const handleDetachProject = async () => {
    setShowDetachConfirm(false);
    const target = activeProject;
    await projectManager.switchProject(null);
    if (target) {
      projectManager.removeRecentProject(target);
    }
    shared.showToast("已分离当前工作区，返回独立会话模式", "info");
  };

  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen || initialTab !== prevInitialTab) {
    setPrevOpen(open);
    setPrevInitialTab(initialTab);
    if (open) {
      setActiveTab(initialTab);
    }
  }

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const currentProviderLabel = shared.llmActiveProvider
    ? PROVIDER_METADATA[shared.llmActiveProvider]?.label ?? shared.llmActiveProvider
    : "系统默认 Provider (未单独配置)";

  const otherRecentProjects = recentProjects.filter(
    (p) => !activeProject || p.toLowerCase() !== activeProject.toLowerCase(),
  );

  return (
    <div className="settings-modal-overlay" role="dialog" aria-modal="true" aria-label="设置中心">
      <button
        type="button"
        className="settings-modal-backdrop"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="settings-modal">
        {/* 关闭按钮 */}
        <button
          type="button"
          className="settings-modal__close-btn"
          onClick={onClose}
          title="关闭 (Esc)"
          aria-label="关闭设置"
        >
          <X size={18} />
        </button>

        {/* ─── 左侧导航栏 ─────────────────────────────── */}
        <nav className="settings-modal__sidebar" aria-label="设置分类">
          <div className="settings-modal__sidebar-header">
            <span className="settings-modal__sidebar-kicker">设置</span>
          </div>

          <div className="settings-modal__nav-list" role="tablist">
            {/* 1. 主设置分类 */}
            <div className="settings-modal__nav-group">
              <button
                type="button"
                role="tab"
                aria-label="常规概览"
                aria-selected={activeTab === "general"}
                className={`settings-modal__nav-item ${activeTab === "general" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <Sliders size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">常规</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label="存储与维护"
                aria-selected={activeTab === "app"}
                className={`settings-modal__nav-item ${activeTab === "app" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("app")}
              >
                <Database size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">应用</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label="外观与语言"
                aria-selected={activeTab === "appearance"}
                className={`settings-modal__nav-item ${activeTab === "appearance" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("appearance")}
              >
                <Palette size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">外观</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label="模型配置"
                aria-selected={activeTab === "models"}
                className={`settings-modal__nav-item ${activeTab === "models" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("models")}
              >
                <Cpu size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">模型</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label="技能与记忆"
                aria-selected={activeTab === "custom"}
                className={`settings-modal__nav-item ${activeTab === "custom" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("custom")}
              >
                <Sparkles size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">自定义</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label="联网检索"
                aria-selected={activeTab === "browser"}
                className={`settings-modal__nav-item ${activeTab === "browser" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("browser")}
              >
                <Globe size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">浏览器</span>
              </button>
            </div>

            {/* 2. 工作区项目分组 (真实与 projectManager 对齐) */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">工作区项目</div>
              {activeProject ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "project"}
                  className={`settings-modal__nav-item ${activeTab === "project" ? "settings-modal__nav-item--active" : ""}`}
                  onClick={() => setActiveTab("project")}
                  title={activeProject}
                >
                  <Folder size={15} className="settings-modal__nav-icon" />
                  <span className="settings-modal__nav-item-text">
                    {getProjectDisplayName(activeProject)}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "project"}
                  className={`settings-modal__nav-item ${activeTab === "project" ? "settings-modal__nav-item--active" : ""}`}
                  onClick={() => setActiveTab("project")}
                >
                  <FolderX size={15} className="settings-modal__nav-icon" />
                  <span className="settings-modal__nav-item-text">未绑定工作区</span>
                </button>
              )}

              {otherRecentProjects.slice(0, 3).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="settings-modal__nav-item settings-modal__nav-item--sub"
                  onClick={async () => {
                    await projectManager.switchProject(p);
                    setActiveTab("project");
                  }}
                  title={`切换至项目：${p}`}
                >
                  <span className="settings-modal__project-dot" />
                  <span className="settings-modal__nav-item-text">{getProjectDisplayName(p)}</span>
                </button>
              ))}

              <button
                type="button"
                className="settings-modal__nav-item settings-modal__nav-item--link"
                onClick={handlePickWorkspace}
              >
                <FolderPlus size={13} style={{ marginRight: 6 }} />
                <span className="settings-modal__nav-item-text">打开其他工作区...</span>
              </button>
            </div>

            {/* 3. 快速导航 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">快捷入口</div>
              <button
                type="button"
                className="settings-modal__nav-item"
                onClick={onClose}
              >
                <span className="settings-modal__nav-item-text">返回当前会话</span>
              </button>
            </div>
          </div>

          {/* 4. 底部快捷操作与真实客户端信息 */}
          <div className="settings-modal__sidebar-footer">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "shortcuts"}
              className={`settings-modal__sidebar-footer-link ${activeTab === "shortcuts" ? "settings-modal__sidebar-footer-link--active" : ""}`}
              onClick={() => setActiveTab("shortcuts")}
            >
              <Keyboard size={14} />
              <span>快捷键速查</span>
            </button>

            <button
              type="button"
              className="settings-modal__sidebar-footer-link"
              onClick={() => {
                void openExternalUrl("https://github.com/liangcka/Yachiyo-chat-desktop");
              }}
            >
              <HelpCircle size={14} />
              <span>问题反馈</span>
            </button>

            {/* 左下角用户设置（纯本地保存） */}
            <button
              type="button"
              role="tab"
              aria-label="用户设置"
              aria-selected={activeTab === "user"}
              className={`settings-modal__client-bar settings-modal__user-bar ${activeTab === "user" ? "settings-modal__user-bar--active" : ""}`}
              onClick={() => setActiveTab("user")}
              title="用户设置（纯本地偏好）"
            >
              <div className="settings-modal__client-icon settings-modal__user-icon">
                {userSettings.avatar ? (
                  <img
                    src={userSettings.avatar}
                    alt={userSettings.username || "用户头像"}
                    className="settings-modal__user-avatar-thumb"
                  />
                ) : (
                  <User size={14} />
                )}
              </div>
              <div className="settings-modal__client-info">
                <span className="settings-modal__client-title">
                  {userSettings.username || "酒寄彩叶"}
                </span>
                <span className="settings-modal__client-subtitle">
                  本地专属 · 个人资料
                </span>
              </div>
            </button>
          </div>
        </nav>

        {/* ─── 右侧内容区域 ─────────────────────────────── */}
        <main className="settings-modal__content" role="tabpanel">
          {/* TAB: 常规 (General) */}
          {activeTab === "general" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">常规</h3>
                <p className="settings-panel-view__desc">
                  速览客户端运行环境、隐私保护策略与各项服务连接状态。
                </p>
              </div>

              {/* 1. 隐私与数据安全 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">隐私保护与数据策略</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">本地隐私保护模式</strong>
                    <span className="settings-item-card__desc">
                      启用后，您的对话内容、代码修改与工作区文件交互仅安全保存在当前设备的本地存储中，绝不上传至任何遥测分析或第三方日志服务器。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={privacyMode}
                      className={`settings-toggle-switch ${privacyMode ? "settings-toggle-switch--active" : ""}`}
                      onClick={handleTogglePrivacyMode}
                      aria-label="切换隐私模式"
                    >
                      <span className="settings-toggle-knob" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. 当前工作区状态 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">工作区与项目环境</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">活跃工作区目录</strong>
                    <span className="settings-item-card__desc">
                      {activeProject
                        ? `当前已关联本地项目：${activeProject}`
                        : "尚未关联本地工程目录，当前处于无工作区的独立对话模式。"}
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    {activeProject ? (
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => setActiveTab("project")}
                      >
                        工作区配置
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn settings-btn--primary"
                        onClick={handlePickWorkspace}
                      >
                        选择工作区
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. 系统运行状态速览 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">核心系统状态</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">大语言模型服务 (LLM)</strong>
                    <span className="settings-item-card__desc">
                      当前活跃 Provider: <strong>{currentProviderLabel}</strong>
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("models")}
                    >
                      管理模型供应商
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">联网检索能力 (Web Search)</strong>
                    <span className="settings-item-card__desc">
                      当前状态：
                      <strong>
                        {shared.webSearchSettings.enabled
                          ? "已启用（支持多搜索引擎级联容灾）"
                          : "已停用（纯离线模型知识）"}
                      </strong>
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("browser")}
                    >
                      配置检索
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">本地数据库 (IndexedDB)</strong>
                    <span className="settings-item-card__desc">
                      本地持久化数据库正常运行，当前共保存{" "}
                      <strong>{shared.conversations.length}</strong> 组历史会话。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("app")}
                    >
                      数据管理
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB: 外观与语言 (Appearance) */}
          {activeTab === "appearance" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">外观与语言</h3>
                <p className="settings-panel-view__desc">自定义界面色彩主题、明暗模式与多语言本地化。</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">界面偏好</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">色彩主题</strong>
                    <span className="settings-item-card__desc">
                      当前主题：{resolvedTheme === "dark" ? "星空深色 (Dark)" : "皓月浅色 (Light)"}
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    {onToggleTheme ? (
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={onToggleTheme}
                      >
                        {resolvedTheme === "dark" ? "切换为浅色" : "切换为深色"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">界面多语言</strong>
                    <span className="settings-item-card__desc">
                      当前语言：{shared.controller.locale === "zh-CN" ? "简体中文" : "日本語"}
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() =>
                        void shared.onLocale(shared.controller.locale === "zh-CN" ? "ja-JP" : "zh-CN")
                      }
                    >
                      {shared.controller.locale === "zh-CN" ? "日本語に切替" : "切换为中文"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB: 模型配置 (Models) */}
          {activeTab === "models" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">大模型供应商与 Key 管理</h3>
                <p className="settings-panel-view__desc">
                  配置各 LLM Provider 厂商 API Key 与默认模型（StepFun、DeepSeek、GLM、Claude、OpenAI、Gemini）。与系统安全凭据库安全打通。
                </p>
              </div>

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
            </div>
          ) : null}

          {/* TAB: 技能与记忆 (Custom) */}
          {activeTab === "custom" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">技能与个性化记忆</h3>
                <p className="settings-panel-view__desc">配置智能体技能扩展与八千代的长期个性化设定记忆。</p>
              </div>

              <div className="settings-custom-stack">
                <div className="settings-card-group">
                  <h4 className="settings-card-group__title">八千代的长期记忆</h4>
                  <UserMemoryPanel
                    copy={shared.copy}
                    memory={shared.controller.userMemory ?? ""}
                    onClose={onClose}
                    onSave={async (memory) => {
                      const saved = await shared.controller.updateUserMemory(memory);
                      if (saved) {
                        shared.showToast(shared.copy.userMemorySaved, "info");
                      } else {
                        shared.showToast(shared.copy.userMemorySaveFailed, "error");
                      }
                      return saved;
                    }}
                    open={true}
                    embedded={true}
                  />
                </div>

                <div className="settings-card-group">
                  <h4 className="settings-card-group__title">技能扩展</h4>
                  <SkillsPanel
                    activeIds={shared.activeSkillIds}
                    copy={shared.copy}
                    onClose={onClose}
                    onToggle={(id, next) => void shared.onSkillToggle(id, next)}
                    onWebSearchSettingsChange={shared.onWebSearchSettingsChange}
                    open={true}
                    skills={SKILLS}
                    webSearchSettings={shared.webSearchSettings}
                    embedded={true}
                    hideWebSearch={true}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB: 联网检索 (Browser) */}
          {activeTab === "browser" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">联网检索与网络管道</h3>
                <p className="settings-panel-view__desc">配置智能体联网检索管道、搜索引擎级联容灾与来源展示。</p>
              </div>

              <SkillsPanel
                activeIds={shared.activeSkillIds}
                copy={shared.copy}
                onClose={onClose}
                onToggle={(id, next) => void shared.onSkillToggle(id, next)}
                onWebSearchSettingsChange={shared.onWebSearchSettingsChange}
                open={true}
                skills={[]}
                webSearchSettings={shared.webSearchSettings}
                embedded={true}
                onlyWebSearch={true}
              />
            </div>
          ) : null}

          {/* TAB: 工作区与项目 (Project - 真实对接真实环境) */}
          {activeTab === "project" ? (
            <div className="settings-panel-view settings-panel-view--project">
              <div className="settings-project-header">
                <div className="settings-project-header__title-row">
                  <div className="settings-project-title-container">
                    <h3 className="settings-panel-view__title settings-project-title">
                      {activeProject ? getProjectDisplayName(activeProject) : "工作区与项目管理"}
                    </h3>
                  </div>

                  {activeProject ? (
                    <button
                      type="button"
                      className={`settings-terminal-toggle-btn ${showWorkspaceTerminal ? "settings-terminal-toggle-btn--active" : ""}`}
                      onClick={() => setShowWorkspaceTerminal((prev) => !prev)}
                      title="切换高级工作区与终端面板"
                    >
                      <Terminal size={14} />
                      <span>{showWorkspaceTerminal ? "返回项目概览" : "打开终端与文件树"}</span>
                    </button>
                  ) : null}
                </div>
                <p className="settings-panel-view__desc settings-project-desc">
                  {activeProject
                    ? "当前工作区已启用文件系统观察守卫、Monaco 编辑器差异审阅与终端执行环境。"
                    : "打开本地代码目录即可启用 Agent 工具调用、工程文件读取修改与代码审阅。"}
                </p>
              </div>

              {showWorkspaceTerminal ? (
                <div className="settings-workspace-embedded">
                  <WorkspacePanel copy={shared.copy} open={true} onClose={onClose} />
                </div>
              ) : (
                <>
                  {/* 1. 当前工作区信息卡片 */}
                  <div className="settings-card-group">
                    <h4 className="settings-card-group__title">工作区路径</h4>
                    {activeProject ? (
                      <div className="settings-item-card">
                        <div className="settings-item-card__lead">
                          <strong className="settings-item-card__name">
                            {getProjectDisplayName(activeProject)}
                          </strong>
                          <span className="settings-item-card__desc" style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                            {activeProject}
                          </span>
                        </div>
                        <div className="settings-item-card__action">
                          <button
                            type="button"
                            className="settings-btn settings-btn--ghost"
                            onClick={() => void handleCopyPath(activeProject)}
                          >
                            {copiedPath ? (
                              <>
                                <Check size={13} style={{ color: "#10b981", marginRight: 4 }} />
                                已复制
                              </>
                            ) : (
                              "复制路径"
                            )}
                          </button>
                          <button
                            type="button"
                            className="settings-btn"
                            onClick={handlePickWorkspace}
                          >
                            切换工作区
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="settings-item-card">
                        <div className="settings-item-card__lead">
                          <strong className="settings-item-card__name">暂未打开任何项目目录</strong>
                          <span className="settings-item-card__desc">
                            您可以打开本地已有的代码仓库，或使用快速开始创建临时工作空间。
                          </span>
                        </div>
                        <div className="settings-item-card__action">
                          <button
                            type="button"
                            className="settings-btn settings-btn--primary"
                            onClick={handlePickWorkspace}
                          >
                            <FolderPlus size={14} style={{ marginRight: 4 }} />
                            选择本地文件夹
                          </button>
                          <button
                            type="button"
                            className="settings-btn"
                            onClick={handleQuickStartWorkspace}
                          >
                            <Play size={14} style={{ marginRight: 4 }} />
                            快速开始
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. 智能体工程规则 (真实规则与契约展示) */}
                  <div className="settings-card-group">
                    <h4 className="settings-card-group__title">工程契约与安全规则</h4>
                    <div className="settings-item-card">
                      <div className="settings-item-card__lead">
                        <strong className="settings-item-card__name">Agent 开发规范 (AGENTS.md)</strong>
                        <span className="settings-item-card__desc">
                          工作区内的工具执行严格遵循“先读后改”观察守卫、CAS 版本校验、移动端原生代码隔离以及破坏性操作事前审批。
                        </span>
                      </div>
                      <div className="settings-item-card__action">
                        <button
                          type="button"
                          className="settings-btn settings-btn--ghost"
                          onClick={() => void handleCopyRuleContract()}
                        >
                          {copiedRule ? (
                            <>
                              <Check size={13} style={{ color: "#10b981", marginRight: 4 }} />
                              已复制契约
                            </>
                          ) : (
                            "复制契约"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 3. 已加载技能清单 (真实动态渲染 SKILLS) */}
                  <div className="settings-card-group">
                    <h4 className="settings-card-group__title">
                      已注册技能扩展 ({SKILLS.length})
                    </h4>
                    <div className="settings-skills-tag-grid">
                      {SKILLS.map((skill) => {
                        const isActive = shared.activeSkillIds.includes(skill.id);
                        return (
                          <button
                            type="button"
                            key={skill.id}
                            className={`settings-skill-tag ${isActive ? "settings-skill-tag--active" : ""}`}
                            title={skill.description}
                            onClick={() => setActiveTab("custom")}
                          >
                            <span className={`settings-skill-tag__dot ${isActive ? "settings-skill-tag__dot--active" : ""}`} />
                            <span className="settings-skill-tag__text">{skill.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 4. 危险区域 (仅当有活跃项目时展示真实分离操作) */}
                  {activeProject ? (
                    <div className="settings-card-group settings-card-group--danger-zone">
                      <h4 className="settings-card-group__title settings-card-group__title--danger">
                        危险区域
                      </h4>
                      <div className="settings-item-card settings-item-card--danger">
                        <div className="settings-item-card__lead">
                          <strong className="settings-item-card__name">从工作区脱离</strong>
                          <span className="settings-item-card__desc">
                            将当前客户端与工程目录 <strong>{getProjectDisplayName(activeProject)}</strong> 分离，切换回独立会话模式。您的本地磁盘文件不受任何影响。
                          </span>
                        </div>
                        <div className="settings-item-card__action">
                          {showDetachConfirm ? (
                            <div className="settings-confirm-row">
                              <button
                                type="button"
                                className="settings-btn settings-btn--danger"
                                onClick={() => void handleDetachProject()}
                              >
                                确认脱离
                              </button>
                              <button
                                type="button"
                                className="settings-btn"
                                onClick={() => setShowDetachConfirm(false)}
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="settings-btn settings-btn--danger"
                              onClick={() => setShowDetachConfirm(true)}
                            >
                              脱离工作区
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* TAB: 存储与维护 (App) */}
          {activeTab === "app" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">数据管理与系统维护</h3>
                <p className="settings-panel-view__desc">管理本地 IndexedDB 缓存、会话持久化与凭据清理。</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">数据清理</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">清空本地全部会话</strong>
                    <span className="settings-item-card__desc">
                      永久清除 IndexedDB 中存储的全部历史对话记录与图片附件缓存。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    {showClearConfirm ? (
                      <div className="settings-confirm-row">
                        <button
                          type="button"
                          className="settings-btn settings-btn--danger"
                          onClick={() => {
                            setShowClearConfirm(false);
                            void shared.onClearData();
                          }}
                        >
                          确认清空
                        </button>
                        <button
                          type="button"
                          className="settings-btn"
                          onClick={() => setShowClearConfirm(false)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn settings-btn--danger-text"
                        onClick={() => setShowClearConfirm(true)}
                      >
                        <Trash2 size={13} style={{ display: "inline", marginRight: 4 }} />
                        清空数据
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">上下文智能压缩</strong>
                    <span className="settings-item-card__desc">精炼多轮历史，节约 token 消耗。</span>
                  </div>
                  <div className="settings-item-card__action">
                    {onCompress ? (
                      <button type="button" className="settings-btn" onClick={onCompress}>
                        立即压缩
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">清除服务端凭据</strong>
                    <span className="settings-item-card__desc">清除当前设备在服务端保存的会话 Session Cookie。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => void shared.onSignOut()}
                    >
                      清除凭据
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB: 快捷键速查 (Shortcuts) */}
          {activeTab === "shortcuts" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">键盘快捷键速查</h3>
                <p className="settings-panel-view__desc">全键盘操作映射，帮助您快速掌控桌面端交互。</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">全局操作</h4>
                <div className="settings-shortcut-table">
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">新建会话</span>
                    <kbd className="settings-kbd">Ctrl + N</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">打开 / 收起工作区</span>
                    <kbd className="settings-kbd">Ctrl + B</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">折叠 / 展开侧边栏</span>
                    <kbd className="settings-kbd">Ctrl + [</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">打开系统设置中心</span>
                    <kbd className="settings-kbd">Ctrl + ,</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">关闭弹窗 / 取消对话</span>
                    <kbd className="settings-kbd">Esc</kbd>
                  </div>
                </div>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">输入与发送</h4>
                <div className="settings-shortcut-table">
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">发送消息</span>
                    <kbd className="settings-kbd">Enter</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">输入框内换行</span>
                    <kbd className="settings-kbd">Shift + Enter</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">快捷唤起指令菜单</span>
                    <kbd className="settings-kbd">/</kbd>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB: 用户设置 (User - 纯本地保存) */}
          {activeTab === "user" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">用户设置</h3>
                <p className="settings-panel-view__desc">
                  管理您的本地个人资料、头像与用户名。本页所有数据仅安全保存在当前设备的本地存储中，绝不上传云端。
                </p>
              </div>

              {/* 隐藏的本地头像文件选择器 */}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                aria-label="上传头像文件"
                style={{ display: "none" }}
                onChange={handleAvatarFileChange}
              />

              {/* 1. 个人资料卡片：头像与用户名 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">个人资料 (Profile)</h4>
                <div className="settings-item-card settings-user-profile-card">
                  <div className="settings-user-profile-layout">
                    <div className="settings-user-profile-avatar-col">
                      <div className="settings-user-avatar-wrapper">
                        {userSettings.avatar ? (
                          <img
                            src={userSettings.avatar}
                            alt={userSettings.username || "用户头像"}
                            className="settings-user-avatar-preview"
                          />
                        ) : (
                          <div className="settings-user-avatar-placeholder">
                            <User size={36} />
                          </div>
                        )}
                        <button
                          type="button"
                          className="settings-user-avatar-upload-overlay"
                          onClick={() => avatarInputRef.current?.click()}
                          title="点击更换头像"
                          aria-label="更换头像"
                        >
                          <Camera size={16} />
                        </button>
                      </div>

                      <div className="settings-user-avatar-actions">
                        <button
                          type="button"
                          className="settings-btn settings-btn--ghost settings-btn--sm"
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <Upload size={12} style={{ marginRight: 4 }} />
                          更换头像
                        </button>
                        {userSettings.avatar ? (
                          <button
                            type="button"
                            className="settings-btn settings-btn--ghost settings-btn--sm danger-action"
                            onClick={handleRemoveAvatar}
                          >
                            移除头像
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="settings-user-profile-info-col">
                      <div className="settings-item-card__lead">
                        <strong className="settings-item-card__name">用户名称</strong>
                        <span className="settings-item-card__desc">
                          设置您的个人展示名称。留空保存时将自动恢复为默认角色名称“酒寄彩叶”。
                        </span>
                      </div>

                      <div className="settings-user-input-row">
                        <input
                          type="text"
                          aria-label="用户名"
                          className="settings-user-input"
                          placeholder="酒寄彩叶"
                          value={usernameDraft}
                          maxLength={20}
                          onChange={(e) => setUsernameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveUsername();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="settings-btn settings-btn--primary"
                          onClick={handleSaveUsername}
                        >
                          {usernameSavedToast ? (
                            <>
                              <Check size={13} style={{ marginRight: 4 }} />
                              已保存
                            </>
                          ) : (
                            "保存名称"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 身份称号与等级设置 */}
                <div className="settings-item-card settings-user-badge-card" style={{ marginTop: 12 }}>
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">身份称号 (Badge)</strong>
                    <span className="settings-item-card__desc">
                      设置侧边栏展示的个人称号。可快速选择标准预设（Lite、Plus、Pro、Go）或键入个性称号。
                    </span>
                  </div>
                  <div className="settings-user-badge-settings-block">
                    <div className="settings-user-badge-presets">
                      {PRESET_USER_BADGES.map((badge) => {
                        const isSelected =
                          (userSettings.badge || "Lite").toLowerCase() === badge.toLowerCase();
                        return (
                          <button
                            key={badge}
                            type="button"
                            className={`settings-user-badge-btn settings-user-badge-btn--${badge.toLowerCase()} ${
                              isSelected ? "settings-user-badge-btn--active" : ""
                            }`}
                            onClick={() => handleSaveBadge(badge)}
                          >
                            {badge}
                            {isSelected ? <Check size={12} style={{ marginLeft: 4 }} /> : null}
                          </button>
                        );
                      })}
                    </div>
                    <div className="settings-user-input-row" style={{ marginTop: 10 }}>
                      <input
                        type="text"
                        aria-label="个性称号"
                        className="settings-user-input"
                        placeholder="输入自定义称号 (如 VIP, Go)"
                        maxLength={10}
                        value={badgeDraft}
                        onChange={(e) => setBadgeDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSaveBadge(badgeDraft);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="settings-btn settings-btn--primary"
                        onClick={() => handleSaveBadge(badgeDraft)}
                      >
                        保存称号
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. 本地隐私隔离保证 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">数据安全与本地存储</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">纯本地隔离存储</strong>
                    <span className="settings-item-card__desc">
                      您的头像图片与用户名称仅保存在当前设备的 LocalStorage 中。任何云端服务、网络接口均不会收集或存储该配置。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <span className="settings-user-storage-badge">仅本地有效</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {/* 圆形头像裁剪模态弹窗 */}
      <AvatarCropModal
        open={cropModalOpen}
        imageSrc={rawAvatarSrc}
        onClose={() => {
          setCropModalOpen(false);
          setRawAvatarSrc("");
        }}
        onConfirm={handleConfirmCropAvatar}
      />
    </div>
  );
}
