import {
  Cpu,
  Database,
  ExternalLink,
  Folder,
  Globe,
  Keyboard,
  LogOut,
  Palette,
  Sliders,
  Sparkles,
  Trash2,
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
  | "general"
  | "appearance"
  | "models"
  | "custom"
  | "browser"
  | "project"
  | "app"
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
            <h2 className="settings-modal__sidebar-title">系统偏好设置</h2>
          </div>

          <div className="settings-modal__nav-list" role="tablist">
            {/* 1. 基础配置 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">核心功能</div>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "general"}
                className={`settings-modal__nav-item ${activeTab === "general" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <Sliders size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">常规概览</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "appearance"}
                className={`settings-modal__nav-item ${activeTab === "appearance" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("appearance")}
              >
                <Palette size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">外观与语言</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "models"}
                className={`settings-modal__nav-item ${activeTab === "models" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("models")}
              >
                <Cpu size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">模型配置</span>
              </button>
            </div>

            {/* 2. 智能体与能力 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">能力与扩展</div>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "custom"}
                className={`settings-modal__nav-item ${activeTab === "custom" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("custom")}
              >
                <Sparkles size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">技能与记忆</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "browser"}
                className={`settings-modal__nav-item ${activeTab === "browser" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("browser")}
              >
                <Globe size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">联网检索</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "project"}
                className={`settings-modal__nav-item ${activeTab === "project" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("project")}
              >
                <Folder size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">工作区</span>
              </button>
            </div>

            {/* 3. 数据与安全 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">系统与维护</div>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "app"}
                className={`settings-modal__nav-item ${activeTab === "app" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("app")}
              >
                <Database size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">存储与维护</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "shortcuts"}
                className={`settings-modal__nav-item ${activeTab === "shortcuts" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("shortcuts")}
              >
                <Keyboard size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">快捷键</span>
              </button>
            </div>
          </div>

          {/* 底部信息与外链 */}
          <div className="settings-modal__sidebar-footer">
            <button
              type="button"
              className="settings-modal__footer-btn"
              onClick={() => window.open("https://github.com/liangcka/Yachiyo-chat-desktop", "_blank")}
            >
              <span>GitHub 项目主页</span>
              <ExternalLink size={13} style={{ marginLeft: "auto", opacity: 0.6 }} />
            </button>

            <div className="settings-modal__app-badge">
              <span className="settings-modal__app-title">Yachiyo Chat Desktop</span>
              <span className="settings-modal__app-version">v1.0.0 (Tauri 2 + Cloudflare)</span>
            </div>
          </div>
        </nav>

        {/* ─── 右侧内容区域 ─────────────────────────────── */}
        <main className="settings-modal__content" role="tabpanel">
          {/* TAB 1: 常规概览 (General) */}
          {activeTab === "general" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">常规概览</h3>
                <p className="settings-panel-view__desc">速览当前客户端运行状态、活跃模型与快捷操作。</p>
              </div>

              {/* 运行状态卡片 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">运行状态</h4>
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

              {/* 快捷操作 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">快捷操作</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">开启全新对话</strong>
                    <span className="settings-item-card__desc">重置当前上下文并创建空白会话。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => {
                        onClose();
                        void shared.onNewChat();
                      }}
                    >
                      新建对话
                    </button>
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
