import { ChevronDown, Info, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LlmSettingsPanel } from "../LlmSettingsPanel";
import { SkillsPanel } from "../SkillsPanel";
import { UserMemoryPanel } from "../UserMemoryPanel";
import { WorkspacePanel } from "../desktop/WorkspacePanel";
import { SKILLS } from "../../skills";
import type { SharedViewProps } from "../../views/layout-types";

export type SettingsTabKey =
  | "general"
  | "app"
  | "appearance"
  | "models"
  | "custom"
  | "browser"
  | "project"
  | "chat"
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
  const [queueMode, setQueueMode] = useState<"queue" | "immediate">("immediate");
  const [securityPreset, setSecurityPreset] = useState<"fast" | "safe" | "strict">("fast");
  const [artifactPolicy, setArtifactPolicy] = useState<"ask" | "auto" | "disable">("ask");
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
            <h2 className="settings-modal__sidebar-title">设置</h2>
          </div>

          <div className="settings-modal__nav-list" role="tablist">
            {/* 1. 全局设置项 */}
            <div className="settings-modal__nav-group">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "general"}
                className={`settings-modal__nav-item ${activeTab === "general" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <span>常规</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "app"}
                className={`settings-modal__nav-item ${activeTab === "app" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("app")}
              >
                <span>应用</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "appearance"}
                className={`settings-modal__nav-item ${activeTab === "appearance" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("appearance")}
              >
                <span>外观</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "models"}
                className={`settings-modal__nav-item ${activeTab === "models" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("models")}
              >
                <span>模型</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "custom"}
                className={`settings-modal__nav-item ${activeTab === "custom" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("custom")}
              >
                <span>自定义</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "browser"}
                className={`settings-modal__nav-item ${activeTab === "browser" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("browser")}
              >
                <span>浏览器</span>
              </button>
            </div>

            {/* 2. 项目与工作区分组 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">项目</div>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "project"}
                className={`settings-modal__nav-item ${activeTab === "project" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("project")}
              >
                <span className="settings-modal__nav-item-text">Yachiyo-chat-desktop</span>
              </button>
              <button
                type="button"
                className="settings-modal__nav-item settings-modal__nav-item--subtle"
                onClick={() => setActiveTab("project")}
              >
                <span className="settings-modal__nav-item-text">Yachiyo chat</span>
              </button>
              <button
                type="button"
                className="settings-modal__nav-item settings-modal__nav-item--subtle"
                onClick={() => setActiveTab("project")}
              >
                <span className="settings-modal__nav-item-text">281990</span>
              </button>
              <button
                type="button"
                className="settings-modal__nav-link-btn"
                onClick={() => setActiveTab("project")}
              >
                显示全部
              </button>
            </div>

            {/* 3. 未在项目中 */}
            <div className="settings-modal__nav-group">
              <div className="settings-modal__nav-section-title">未在项目中</div>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "chat"}
                className={`settings-modal__nav-item ${activeTab === "chat" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("chat")}
              >
                <span>对话</span>
              </button>
            </div>
          </div>

          {/* 4. 底部快捷键与账户卡片 */}
          <div className="settings-modal__sidebar-footer">
            <button
              type="button"
              className={`settings-modal__footer-btn ${activeTab === "shortcuts" ? "settings-modal__footer-btn--active" : ""}`}
              onClick={() => setActiveTab("shortcuts")}
            >
              <span>快捷键</span>
            </button>

            <button
              type="button"
              className="settings-modal__footer-btn"
              onClick={() => window.open("https://github.com/liangcka/Yachiyo-chat-desktop", "_blank")}
            >
              <span>提供反馈</span>
            </button>

            {/* 用户身份与状态卡片 */}
            <div className="settings-modal__user-card">
              <div className="settings-modal__user-avatar">
                <User size={16} />
              </div>
              <div className="settings-modal__user-info">
                <span className="settings-modal__user-name">anon chihaya</span>
                <span className="settings-modal__user-email">xychunliang@gmail.com</span>
              </div>
            </div>
          </div>
        </nav>

        {/* ─── 右侧内容区域 ─────────────────────────────── */}
        <main className="settings-modal__content" role="tabpanel">
          {/* TAB 1: 常规 (严格对齐用户设计图) */}
          {activeTab === "general" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">常规</h3>
                <p className="settings-panel-view__desc">配置智能体执行、排队消息发送以及权限。</p>
              </div>

              {/* 1. 执行 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">执行</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">排队消息</strong>
                    <span className="settings-item-card__desc">配置何时发送后续消息。</span>
                    <span className="settings-item-card__hint">
                      键盘快捷键 <Info size={12} />
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <div className="settings-segment-control">
                      <button
                        type="button"
                        className={`settings-segment-btn ${queueMode === "queue" ? "settings-segment-btn--active" : ""}`}
                        onClick={() => setQueueMode("queue")}
                      >
                        排队
                      </button>
                      <button
                        type="button"
                        className={`settings-segment-btn ${queueMode === "immediate" ? "settings-segment-btn--active" : ""}`}
                        onClick={() => setQueueMode("immediate")}
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
                    <span className="settings-item-card__hint">
                      了解更多 about 极速模式 <Info size={12} />
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <div className="settings-select-wrapper">
                      <select
                        className="settings-select"
                        value={securityPreset}
                        onChange={(e) => setSecurityPreset(e.target.value as "fast" | "safe" | "strict")}
                      >
                        <option value="fast">极速模式</option>
                        <option value="safe">安全模式</option>
                        <option value="strict">严格模式</option>
                      </select>
                      <ChevronDown size={14} className="settings-select__chevron" />
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
                        onChange={(e) => setArtifactPolicy(e.target.value as "ask" | "auto" | "disable")}
                      >
                        <option value="ask">始终询问</option>
                        <option value="auto">自动批准</option>
                        <option value="disable">禁用产物</option>
                      </select>
                      <ChevronDown size={14} className="settings-select__chevron" />
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
                      className="settings-btn"
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
                    <div className="settings-item-card__name-row">
                      <strong className="settings-item-card__name">网络访问规则</strong>
                      <span className="settings-badge">6</span>
                    </div>
                    <span className="settings-item-card__desc">配置允许和拒绝读取的 URL。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
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
                    <div className="settings-item-card__name-row">
                      <strong className="settings-item-card__name">终端命令</strong>
                      <span className="settings-badge">32</span>
                    </div>
                    <span className="settings-item-card__desc">配置允许的终端命令。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
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
                      className="settings-btn"
                      onClick={() => setActiveTab("project")}
                    >
                      打开
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <div className="settings-item-card__name-row">
                      <strong className="settings-item-card__name">MCP 工具</strong>
                      <span className="settings-badge">3</span>
                    </div>
                    <span className="settings-item-card__desc">
                      配置通过 模型上下文协议 (MCP) 使用的外部工具。
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("custom")}
                    >
                      打开
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 2: 应用 (App & Storage) */}
          {activeTab === "app" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">应用</h3>
                <p className="settings-panel-view__desc">管理离线缓存、PWA 更新以及本地数据库。</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">数据管理与清理</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">清空本地会话数据</strong>
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
                        清空数据
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">安全退出登录</strong>
                    <span className="settings-item-card__desc">清除当前会话鉴权凭据并返回登录验证网关。</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn settings-btn--danger"
                      onClick={() => void shared.onSignOut()}
                    >
                      退出登录
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 3: 外观 (Appearance & Language) */}
          {activeTab === "appearance" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">外观</h3>
                <p className="settings-panel-view__desc">自定义界面色彩、主题模式以及多语言本地化。</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">主题与语言</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">色彩主题</strong>
                    <span className="settings-item-card__desc">
                      当前主题：{resolvedTheme === "dark" ? "深色模式 (Dark)" : "浅色模式 (Light)"}
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
                    <strong className="settings-item-card__name">界面语言</strong>
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

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">对话上下文压缩</strong>
                    <span className="settings-item-card__desc">
                      使用 AI 生成阶段性摘要，精简上下文 token 消耗。
                    </span>
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

          {/* TAB 4: 模型 (Models / LLM) */}
          {activeTab === "models" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">模型</h3>
                <p className="settings-panel-view__desc">
                  配置各 LLM Provider 厂商 API Key 与默认模型（StepFun、DeepSeek、GLM、Claude、OpenAI、Gemini）。
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

          {/* TAB 5: 自定义 (Customization: 技能 & 记忆) */}
          {activeTab === "custom" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">自定义</h3>
                <p className="settings-panel-view__desc">配置智能体技能插件、MCP 工具与八千代的长期个性化记忆。</p>
              </div>

              <div className="settings-custom-stack">
                <div className="settings-card-group">
                  <h4 className="settings-card-group__title">长期个性化记忆</h4>
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
                  <h4 className="settings-card-group__title">技能插件与能力扩展</h4>
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

          {/* TAB 6: 浏览器与联网搜索 (Browser & Web Search) */}
          {activeTab === "browser" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">浏览器与网络</h3>
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

          {/* TAB 7: 项目与工作区 (Project & Workspace) */}
          {activeTab === "project" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">项目与工作区</h3>
                <p className="settings-panel-view__desc">管理当前绑定的本地工作区目录、代码文件索引与终端命令。</p>
              </div>

              <WorkspacePanel copy={shared.copy} open={true} onClose={onClose} />
            </div>
          ) : null}

          {/* TAB 8: 对话管理 (Chat) */}
          {activeTab === "chat" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">未在项目中的对话</h3>
                <p className="settings-panel-view__desc">管理未绑定特定工作区目录的日常对话与临时交互记录。</p>
              </div>

              <div className="settings-item-card">
                <div className="settings-item-card__lead">
                  <strong className="settings-item-card__name">当前独立会话数</strong>
                  <span className="settings-item-card__desc">
                    本地共存储了 {shared.conversations.length} 条会话记录。
                  </span>
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
                    新建独立对话
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 9: 快捷键 (Shortcuts) */}
          {activeTab === "shortcuts" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">键盘快捷键</h3>
                <p className="settings-panel-view__desc">速查常用全局与对话操作快捷键，提升生产力。</p>
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
                    <span className="settings-shortcut-name">打开系统设置</span>
                    <kbd className="settings-kbd">Ctrl + ,</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">关闭弹窗 / 面板</span>
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
                    <span className="settings-shortcut-name">多行换行</span>
                    <kbd className="settings-kbd">Shift + Enter</kbd>
                  </div>
                  <div className="settings-shortcut-row">
                    <span className="settings-shortcut-name">快捷唤起指令</span>
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
