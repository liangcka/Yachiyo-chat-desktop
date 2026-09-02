import {
  ChevronDown,
  Cpu,
  Database,
  ExternalLink,
  Folder,
  Globe,
  HelpCircle,
  Keyboard,
  LogOut,
  MoreHorizontal,
  Palette,
  Sliders,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LlmSettingsPanel } from "../LlmSettingsPanel";
import { SkillsPanel } from "../SkillsPanel";
import { UserMemoryPanel } from "../UserMemoryPanel";
import { WorkspacePanel } from "../desktop/WorkspacePanel";
import { SKILLS } from "../../skills";
import { PROVIDER_METADATA } from "../../domain/llm";
import type { SharedViewProps } from "../../views/layout-types";

export type SettingsTabKey =
  | "account"
  | "general"
  | "app"
  | "appearance"
  | "models"
  | "custom"
  | "browser"
  | "project"
  | "shortcuts";

export interface SettingsModalProps {
  initialTab?: SettingsTabKey;
  onClose: () => void;
  onCompress?: () => void;
  onToggleTheme?: () => void;
  open: boolean;
  resolvedTheme?: "light" | "dark";
  shared: SharedViewProps;
}

const STORAGE_QUEUE_POLICY = "yachiyo-settings-queue-policy";
const STORAGE_SECURITY_PRESET = "yachiyo-settings-security-preset";
const STORAGE_ARTIFACT_POLICY = "yachiyo-settings-artifact-policy";
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
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  // 1. 排队消息策略 ('queue' | 'immediate')
  const [queuePolicy, setQueuePolicy] = useState<"queue" | "immediate">(() => {
    try {
      const stored = localStorage.getItem(STORAGE_QUEUE_POLICY);
      return stored === "queue" ? "queue" : "immediate";
    } catch {
      return "immediate";
    }
  });

  // 2. 安全预设 ('fast' | 'standard' | 'strict')
  const [securityPreset, setSecurityPreset] = useState<"fast" | "standard" | "strict">(() => {
    try {
      const stored = localStorage.getItem(STORAGE_SECURITY_PRESET);
      if (stored === "standard" || stored === "strict" || stored === "fast") return stored;
      return "fast";
    } catch {
      return "fast";
    }
  });

  // 3. 产物审核策略 ('always_ask' | 'auto_approve' | 'read_only')
  const [artifactPolicy, setArtifactPolicy] = useState<"always_ask" | "auto_approve" | "read_only">(() => {
    try {
      const stored = localStorage.getItem(STORAGE_ARTIFACT_POLICY);
      if (stored === "auto_approve" || stored === "read_only" || stored === "always_ask") return stored;
      return "always_ask";
    } catch {
      return "always_ask";
    }
  });

  // 4. 隐私模式 (boolean)
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PRIVACY_MODE);
      return stored !== "false";
    } catch {
      return true;
    }
  });

  const handleSetQueuePolicy = (policy: "queue" | "immediate") => {
    setQueuePolicy(policy);
    try {
      localStorage.setItem(STORAGE_QUEUE_POLICY, policy);
    } catch {
      /* ignore storage failure */
    }
  };

  const handleSetSecurityPreset = (preset: "fast" | "standard" | "strict") => {
    setSecurityPreset(preset);
    try {
      localStorage.setItem(STORAGE_SECURITY_PRESET, preset);
    } catch {
      /* ignore storage failure */
    }
  };

  const handleSetArtifactPolicy = (policy: "always_ask" | "auto_approve" | "read_only") => {
    setArtifactPolicy(policy);
    try {
      localStorage.setItem(STORAGE_ARTIFACT_POLICY, policy);
    } catch {
      /* ignore storage failure */
    }
  };

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
    : "默认服务 (System Default)";

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

            {/* 2. 项目分组 (Projects) */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">项目</div>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "project"}
                className={`settings-modal__nav-item ${activeTab === "project" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("project")}
              >
                <Folder size={15} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">Yachiyo-chat-desktop</span>
              </button>

              <button
                type="button"
                className="settings-modal__nav-item settings-modal__nav-item--sub"
                onClick={() => setActiveTab("project")}
              >
                <span className="settings-modal__project-dot" />
                <span className="settings-modal__nav-item-text">Yachiyo chat</span>
              </button>

              <button
                type="button"
                className="settings-modal__nav-item settings-modal__nav-item--sub"
                onClick={() => setActiveTab("project")}
              >
                <span className="settings-modal__project-dot" />
                <span className="settings-modal__nav-item-text">281990</span>
              </button>

              <button
                type="button"
                className="settings-modal__nav-item settings-modal__nav-item--link"
                onClick={() => setActiveTab("project")}
              >
                <span className="settings-modal__nav-item-text">显示全部</span>
              </button>
            </div>

            {/* 3. 未在项目中 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">未在项目中</div>
              <button
                type="button"
                className="settings-modal__nav-item"
                onClick={() => {
                  onClose();
                }}
              >
                <span className="settings-modal__nav-item-text">对话</span>
              </button>
            </div>
          </div>

          {/* 4. 底部快捷操作与用户信息条 */}
          <div className="settings-modal__sidebar-footer">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "shortcuts"}
              className={`settings-modal__sidebar-footer-link ${activeTab === "shortcuts" ? "settings-modal__sidebar-footer-link--active" : ""}`}
              onClick={() => setActiveTab("shortcuts")}
            >
              <Keyboard size={14} />
              <span>快捷键</span>
            </button>

            <button
              type="button"
              className="settings-modal__sidebar-footer-link"
              onClick={() => window.open("https://github.com/liangcka/Yachiyo-chat-desktop/issues", "_blank")}
            >
              <HelpCircle size={14} />
              <span>提供反馈</span>
              <ExternalLink size={12} style={{ marginLeft: "auto", opacity: 0.6 }} />
            </button>

            {/* 底部用户卡片 (点击直达账号页) */}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "account"}
              className={`settings-modal__user-bar ${activeTab === "account" ? "settings-modal__user-bar--active" : ""}`}
              onClick={() => setActiveTab("account")}
              title="查看与管理账号信息"
            >
              <div className="settings-modal__user-avatar">
                <User size={16} />
              </div>
              <div className="settings-modal__user-info">
                <span className="settings-modal__user-name">anon chihaya</span>
                <span className="settings-modal__user-email">xychunliang@gmail.com</span>
              </div>
            </button>
          </div>
        </nav>

        {/* ─── 右侧内容区域 ─────────────────────────────── */}
        <main className="settings-modal__content" role="tabpanel">
          {/* TAB: 常规 (General - 图 2 风格) */}
          {activeTab === "general" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">常规</h3>
                <p className="settings-panel-view__desc">
                  配置智能体执行、排队消息发送以及权限。速览当前客户端运行状态、活跃模型与快捷操作。
                </p>
              </div>

              {/* 1. 执行 (Execution) */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">执行</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">排队消息</strong>
                    <span className="settings-item-card__desc">
                      配置何时发送后续消息。
                    </span>
                    <button
                      type="button"
                      className="settings-link-inline"
                      onClick={() => setActiveTab("shortcuts")}
                    >
                      键盘快捷键 ⓘ
                    </button>
                  </div>
                  <div className="settings-item-card__action">
                    <div className="settings-segmented-control" role="group" aria-label="排队消息设置">
                      <button
                        type="button"
                        className={`settings-segmented-btn ${queuePolicy === "queue" ? "settings-segmented-btn--active" : ""}`}
                        onClick={() => handleSetQueuePolicy("queue")}
                      >
                        排队
                      </button>
                      <button
                        type="button"
                        className={`settings-segmented-btn ${queuePolicy === "immediate" ? "settings-segmented-btn--active" : ""}`}
                        onClick={() => handleSetQueuePolicy("immediate")}
                      >
                        立即发送
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Agent 设置 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">Agent 设置</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">安全预设</strong>
                    <span className="settings-item-card__desc">
                      为智能体选择预设安全策略。它会控制终端自动执行策略和文件访问策略。
                    </span>
                    <button
                      type="button"
                      className="settings-link-inline"
                      onClick={() => setActiveTab("project")}
                    >
                      了解更多 about 极速模式 ⓘ
                    </button>
                  </div>
                  <div className="settings-item-card__action">
                    <div className="settings-select-wrapper">
                      <select
                        className="settings-select"
                        value={securityPreset}
                        onChange={(e) =>
                          handleSetSecurityPreset(e.target.value as "fast" | "standard" | "strict")
                        }
                        aria-label="安全预设"
                      >
                        <option value="fast">极速模式</option>
                        <option value="standard">标准模式</option>
                        <option value="strict">严格模式</option>
                      </select>
                      <ChevronDown size={14} className="settings-select-chevron" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. 智能体行为 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">智能体行为</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">产物审核策略</strong>
                    <span className="settings-item-card__desc">
                      指定智能体在请求审核产物时的行为。产物是智能体创建的文档，用于提供更丰富的对话体验。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <div className="settings-select-wrapper">
                      <select
                        className="settings-select"
                        value={artifactPolicy}
                        onChange={(e) =>
                          handleSetArtifactPolicy(
                            e.target.value as "always_ask" | "auto_approve" | "read_only"
                          )
                        }
                        aria-label="产物审核策略"
                      >
                        <option value="always_ask">始终询问</option>
                        <option value="auto_approve">自动批准</option>
                        <option value="read_only">仅只读</option>
                      </select>
                      <ChevronDown size={14} className="settings-select-chevron" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. 文件权限 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">文件权限</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">文件访问规则</strong>
                    <span className="settings-item-card__desc">配置允许和拒绝读写的文件路径。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => setActiveTab("project")}
                    >
                      打开
                    </button>
                  </div>
                </div>
              </div>

              {/* 5. 网络权限 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">网络权限</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <div className="settings-item-title-with-badge">
                      <strong className="settings-item-card__name">网络访问规则</strong>
                      <span className="settings-count-badge">6</span>
                    </div>
                    <span className="settings-item-card__desc">配置允许和拒绝读取的 URL。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => setActiveTab("browser")}
                    >
                      打开
                    </button>
                  </div>
                </div>
              </div>

              {/* 6. 终端与工具权限 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">终端与工具权限</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <div className="settings-item-title-with-badge">
                      <strong className="settings-item-card__name">终端命令</strong>
                      <span className="settings-count-badge">32</span>
                    </div>
                    <span className="settings-item-card__desc">配置允许的终端命令。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => setActiveTab("project")}
                    >
                      打开
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">沙盒外命令</strong>
                    <span className="settings-item-card__desc">配置允许在沙盒外运行的命令。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => setActiveTab("project")}
                    >
                      打开
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <div className="settings-item-title-with-badge">
                      <strong className="settings-item-card__name">MCP 工具</strong>
                      <span className="settings-count-badge">3</span>
                    </div>
                    <span className="settings-item-card__desc">
                      配置通过 模型上下文协议 (MCP) 使用的外部工具。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => setActiveTab("custom")}
                    >
                      打开
                    </button>
                  </div>
                </div>
              </div>

              {/* 7. 运行状态 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">系统状态</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">当前活跃大模型</strong>
                    <span className="settings-item-card__desc">
                      已启用 Provider: {currentProviderLabel}
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("models")}
                    >
                      切换模型
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">本地持久化存储</strong>
                    <span className="settings-item-card__desc">
                      IndexedDB 数据库正常运行，当前共保存 {shared.conversations.length} 组历史会话。
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

          {/* TAB: 账号 (Account - 图 1 风格) */}
          {activeTab === "account" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">账号</h3>
                <p className="settings-panel-view__desc">管理您的账户信息、会员订阅权限以及数据隐私保护策略。</p>
              </div>

              {/* 1. 账户信息 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">账户信息</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">安魂曲</strong>
                    <span className="settings-item-card__desc">152*******49</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => window.open("https://github.com/liangcka/Yachiyo-chat-desktop", "_blank")}
                    >
                      <span>管理账号</span>
                      <ExternalLink size={12} style={{ marginLeft: 4 }} />
                    </button>
                    <button
                      type="button"
                      className="settings-btn settings-btn--icon"
                      title="更多选项"
                      aria-label="更多选项"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <div className="settings-item-title-with-badge">
                      <strong className="settings-item-card__name">会员 Lite</strong>
                      <span className="settings-lite-badge">Lite</span>
                    </div>
                    <span className="settings-item-card__desc">单次购买 · 到期时间 2026/09/22</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() => window.open("https://github.com/liangcka/Yachiyo-chat-desktop", "_blank")}
                    >
                      <span>管理订阅</span>
                      <ExternalLink size={12} style={{ marginLeft: 4 }} />
                    </button>
                    <button
                      type="button"
                      className="settings-btn settings-btn--primary"
                      onClick={() => window.open("https://github.com/liangcka/Yachiyo-chat-desktop", "_blank")}
                    >
                      升级权益
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. 隐私模式 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">隐私模式</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">隐私模式</strong>
                    <span className="settings-item-card__desc">
                      当启用隐私模式时，Yachiyo不会将您的信息（如您的聊天互动，包括相关代码片段和AI生成的输出）用于分析、产品改进和模型训练。更多详情请见{" "}
                      <a
                        href="https://github.com/liangcka/Yachiyo-chat-desktop"
                        target="_blank"
                        rel="noreferrer"
                        className="settings-link-inline-text"
                      >
                        隐私模式
                      </a>
                      。
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

              {/* 3. 退出登录操作 */}
              <div className="settings-card-group" style={{ marginTop: 24 }}>
                {showSignOutConfirm ? (
                  <div className="settings-confirm-row">
                    <span style={{ fontSize: 13, color: "var(--yx-alias-state-error)" }}>
                      确认退出当前登录账号并清除本地 Session？
                    </span>
                    <button
                      type="button"
                      className="settings-btn settings-btn--danger"
                      onClick={() => {
                        setShowSignOutConfirm(false);
                        void shared.onSignOut();
                      }}
                    >
                      确认退出
                    </button>
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setShowSignOutConfirm(false)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="settings-btn settings-btn--ghost"
                    style={{ padding: "8px 18px", fontSize: 13 }}
                    onClick={() => setShowSignOutConfirm(true)}
                  >
                    退出登录
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* TAB 2: 外观与语言 (Appearance) */}
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

          {/* TAB 3: 模型配置 (Models) */}
          {activeTab === "models" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">大模型供应商与 Key 管理</h3>
                <p className="settings-panel-view__desc">
                  配置各 LLM Provider 厂商 API Key 与默认模型（StepFun、DeepSeek、GLM、Claude、OpenAI、Gemini）。已与桌面安全密钥库打通。
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

          {/* TAB 4: 技能与记忆 (Skills & Memory) */}
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
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 5: 联网检索 (Browser / Search) */}
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
                skills={SKILLS.filter((s) => s.id === "web_search" || s.id === "dsh_terminal")}
                webSearchSettings={shared.webSearchSettings}
              />
            </div>
          ) : null}

          {/* TAB 6: 工作区 (Project / Workspace) */}
          {activeTab === "project" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">工作区与本地目录</h3>
                <p className="settings-panel-view__desc">管理桌面端绑定的本地工作区根目录、文件安全边界与工具执行。</p>
              </div>

              <WorkspacePanel copy={shared.copy} open={true} onClose={onClose} />
            </div>
          ) : null}

          {/* TAB 7: 存储与维护 (App & Maintenance) */}
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
                    <strong className="settings-item-card__name">退出登录并清除凭据</strong>
                    <span className="settings-item-card__desc">清除当前会话鉴权 Session Cookie 并返回验证网关。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--danger"
                      onClick={() => void shared.onSignOut()}
                    >
                      <LogOut size={13} style={{ display: "inline", marginRight: 4 }} />
                      退出登录
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 8: 快捷键速查 (Shortcuts) */}
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
        </main>
      </div>
    </div>
  );
}
