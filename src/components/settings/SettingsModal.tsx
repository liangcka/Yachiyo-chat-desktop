import {
  Camera,
  Check,
  Cpu,
  Database,
  Globe,
  HelpCircle,
  Keyboard,
  Palette,
  Puzzle,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
  Server,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../domain/chat";
import { LlmSettingsPanel } from "../LlmSettingsPanel";
import { SkillsPanel } from "../SkillsPanel";
import { UserMemoryPanel } from "../UserMemoryPanel";
import { McpPanel } from "./McpPanel";
import { PluginsPanel } from "./PluginsPanel";
import { SKILLS } from "../../skills";
import { PROVIDER_METADATA } from "../../domain/llm";
import {
  PRESET_USER_BADGES,
  useLocalUserSettings,
} from "../../services/user-settings";
import { AvatarCropModal } from "./AvatarCropModal";
import { isDesktopApp } from "../../services/app-platform";
import { openExternalUrl } from "../../services/desktop-bridge";
import { checkForUpdate, type UpdateCheckResult } from "../../services/update-check";
import type { SharedViewProps } from "../../views/layout-types";

export type SettingsTabKey =
  | "general"
  | "app"
  | "appearance"
  | "models"
  | "custom"
  | "browser"
  | "mcp"
  | "plugins"
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

const zhCopy = {
  defaultUsername: "酒寄彩叶",
  usernameUpdated: (name: string) => `用户名已更新为「${name}」（本地保存）`,
  usernameReset: "用户名已恢复默认（酒寄彩叶）",
  badgeUpdated: (badge: string) => `身份称号已更新为「${badge}」（本地保存）`,
  pickImage: "请选择图片格式文件",
  readImageFailed: "读取图片文件失败",
  avatarSaved: "头像已裁剪并保存至本地",
  avatarReset: "已恢复默认头像",
  defaultProvider: "系统默认 Provider (未单独配置)",
  dialogLabel: "设置中心",
  closeTitle: "关闭 (Esc)",
  closeLabel: "关闭设置",
  navLabel: "设置分类",
  kicker: "设置",
  navGeneralLabel: "常规概览",
  navGeneral: "常规",
  navAppLabel: "存储与维护",
  navApp: "应用",
  navAppearanceLabel: "外观与语言",
  navAppearance: "外观",
  navModelsLabel: "模型配置",
  navModels: "模型",
  navCustomLabel: "技能与记忆",
  navCustom: "自定义",
  navBrowser: "联网搜索",
  navMcp: "MCP 服务",
  navPlugins: "插件",
  shortcutsLink: "快捷键速查",
  feedbackLink: "问题反馈",
  userSettingsLabel: "用户设置",
  userBarTitle: "用户设置（纯本地偏好）",
  userAvatarAlt: "用户头像",
  userBarSubtitle: "本地专属 · 个人资料",
  generalDesc: "速览客户端运行环境、隐私保护策略与各项服务连接状态。",
  privacyGroup: "隐私保护与数据策略",
  privacyName: "本地隐私保护模式",
  privacyDesc:
    "启用后，您的对话内容、代码修改与工作区文件交互仅安全保存在当前设备的本地存储中，绝不上传至任何遥测分析或第三方日志服务器。",
  privacyToggle: "切换隐私模式",
  statusGroup: "核心系统状态",
  llmName: "大语言模型服务 (LLM)",
  llmActivePrefix: "当前活跃 Provider: ",
  manageProviders: "管理模型供应商",
  webSearchPrefix: "当前状态：",
  webSearchOn: "已开启，搜索失败时会自动尝试其他来源",
  webSearchOff: "已停用（纯离线模型知识）",
  configureSearch: "配置搜索",
  dbName: "本地数据库 (IndexedDB)",
  dbDescBefore: "本地持久化数据库正常运行，当前共保存",
  dbDescAfter: "组历史会话。",
  dataManage: "数据管理",
  appearanceTitle: "外观与语言",
  appearanceDesc: "自定义界面色彩主题、明暗模式与多语言本地化。",
  interfaceGroup: "界面偏好",
  themeName: "色彩主题",
  themeCurrent: (dark: boolean) => `当前主题：${dark ? "星空深色 (Dark)" : "皓月浅色 (Light)"}`,
  toLight: "切换为浅色",
  toDark: "切换为深色",
  languageName: "界面多语言",
  languageCurrent: "当前语言：简体中文",
  switchLanguage: "日本語に切替",
  modelsTitle: "大模型供应商与 Key 管理",
  modelsDesc:
    "配置各 LLM Provider 厂商 API Key 与默认模型（StepFun、DeepSeek、GLM、Claude、OpenAI、Gemini）。桌面端的 Key 由系统加密保存在本机。",
  customTitle: "技能与个性化记忆",
  customDesc: "配置智能体技能扩展与八千代的长期个性化设定记忆。",
  memoryGroup: "八千代的长期记忆",
  skillsGroup: "技能扩展",
  browserDesc: "允许八千代搜索网页，并选择是否显示参考来源。",
  appTitle: "数据管理与系统维护",
  appDesc: "管理本地 IndexedDB 缓存、会话持久化、凭据清理与版本更新。",
  cleanupGroup: "数据清理",
  clearAllName: "清空本地全部会话",
  clearAllDesc: "永久清除 IndexedDB 中存储的全部历史对话记录与图片附件缓存。",
  confirmClear: "确认清空",
  cancel: "取消",
  clearData: "清空数据",
  compressName: "上下文智能压缩",
  compressDesc: "精炼多轮历史，节约 token 消耗。",
  compressNow: "立即压缩",
  signOutName: "清除服务端凭据",
  signOutDesc: "清除当前设备在服务端保存的会话 Session Cookie。",
  signOut: "清除凭据",
  updateGroup: "版本与更新",
  updateName: "检查更新",
  updateIdle: "从 GitHub Releases 获取最新正式版。",
  updateChecking: "检查中…",
  updateLatest: (version: string) => `当前版本 v${version}，已是最新。`,
  updateAvailable: (latest: string, current: string) => `发现新版本 v${latest}（当前 v${current}）。`,
  updateFailed: "检查失败，请确认网络连接后重试。",
  updateDownload: "前往下载",
  shortcutsTitle: "键盘快捷键速查",
  shortcutsDesc: "全键盘操作映射，帮助您快速掌控桌面端交互。",
  globalGroup: "全局操作",
  scNewChat: "新建会话",
  scSwitchView: "对话 / 编辑器切换",
  scToggleRightPane: "打开 / 收起成果面板",
  scToggleSidebar: "折叠 / 展开侧边栏",
  scPalette: "命令面板",
  scOpenSettings: "打开系统设置中心",
  scEscape: "关闭弹窗 / 取消对话",
  inputGroup: "输入与发送",
  scSend: "发送消息",
  scNewline: "输入框内换行",
  scSlash: "快捷唤起指令菜单",
  userDesc: "管理您的本地个人资料、头像与用户名。本页所有数据仅安全保存在当前设备的本地存储中，绝不上传云端。",
  avatarFileLabel: "上传头像文件",
  profileGroup: "个人资料 (Profile)",
  changeAvatarTitle: "点击更换头像",
  changeAvatar: "更换头像",
  removeAvatar: "移除头像",
  usernameName: "用户名称",
  usernameDesc: "设置您的个人展示名称。留空保存时将自动恢复为默认角色名称“酒寄彩叶”。",
  usernameLabel: "用户名",
  saved: "已保存",
  saveName: "保存名称",
  badgeName: "身份称号 (Badge)",
  badgeDesc: "设置侧边栏展示的个人称号。可快速选择标准预设（Lite、Plus、Pro、Go）或键入个性称号。",
  badgeLabel: "个性称号",
  badgePlaceholder: "输入自定义称号 (如 VIP, Go)",
  saveBadge: "保存称号",
  storageGroup: "数据安全与本地存储",
  storageName: "纯本地隔离存储",
  storageDesc:
    "您的头像图片与用户名称仅保存在当前设备的 LocalStorage 中。任何云端服务、网络接口均不会收集或存储该配置。",
  localOnly: "仅本地有效",
};

type SettingsCopy = typeof zhCopy;

const jaCopy: SettingsCopy = {
  defaultUsername: "酒寄彩叶",
  usernameUpdated: (name) => `ユーザー名を「${name}」に更新しました（ローカル保存）`,
  usernameReset: "ユーザー名を既定値（酒寄彩叶）に戻しました",
  badgeUpdated: (badge) => `称号を「${badge}」に更新しました（ローカル保存）`,
  pickImage: "画像ファイルを選択してください",
  readImageFailed: "画像ファイルを読み込めませんでした",
  avatarSaved: "アバターを切り抜いてローカルに保存しました",
  avatarReset: "既定のアバターに戻しました",
  defaultProvider: "システム既定のプロバイダー（未設定）",
  dialogLabel: "設定",
  closeTitle: "閉じる (Esc)",
  closeLabel: "設定を閉じる",
  navLabel: "設定カテゴリ",
  kicker: "設定",
  navGeneralLabel: "一般の概要",
  navGeneral: "一般",
  navAppLabel: "ストレージとメンテナンス",
  navApp: "アプリ",
  navAppearanceLabel: "外観と言語",
  navAppearance: "外観",
  navModelsLabel: "モデル設定",
  navModels: "モデル",
  navCustomLabel: "スキルと記憶",
  navCustom: "カスタマイズ",
  navBrowser: "ウェブ検索",
  navMcp: "MCP サーバー",
  navPlugins: "プラグイン",
  shortcutsLink: "ショートカット一覧",
  feedbackLink: "フィードバック",
  userSettingsLabel: "ユーザー設定",
  userBarTitle: "ユーザー設定（ローカルのみ）",
  userAvatarAlt: "ユーザーアバター",
  userBarSubtitle: "ローカル専用 · プロフィール",
  generalDesc: "クライアントの動作環境、プライバシー方針、各サービスの接続状況を確認できます。",
  privacyGroup: "プライバシーとデータ方針",
  privacyName: "ローカルプライバシーモード",
  privacyDesc:
    "有効にすると、会話内容・コードの変更・ワークスペースのファイル操作はこの端末のローカルストレージにのみ保存され、テレメトリやサードパーティのログサーバーへ送信されることはありません。",
  privacyToggle: "プライバシーモードを切り替え",
  statusGroup: "システム状態",
  llmName: "大規模言語モデル (LLM)",
  llmActivePrefix: "使用中のプロバイダー: ",
  manageProviders: "プロバイダーを管理",
  webSearchPrefix: "現在の状態：",
  webSearchOn: "有効（検索に失敗した場合は別のソースを自動で試します）",
  webSearchOff: "無効（モデルの知識のみ）",
  configureSearch: "検索を設定",
  dbName: "ローカルデータベース (IndexedDB)",
  dbDescBefore: "ローカルデータベースは正常に動作しています。保存済みの会話：",
  dbDescAfter: " 件",
  dataManage: "データ管理",
  appearanceTitle: "外観と言語",
  appearanceDesc: "カラーテーマ、ライト／ダークモード、表示言語を設定します。",
  interfaceGroup: "表示設定",
  themeName: "カラーテーマ",
  themeCurrent: (dark) => `現在のテーマ：${dark ? "星空ダーク (Dark)" : "月光ライト (Light)"}`,
  toLight: "ライトに切り替え",
  toDark: "ダークに切り替え",
  languageName: "表示言語",
  languageCurrent: "現在の言語：日本語",
  switchLanguage: "切换为中文",
  modelsTitle: "モデルプロバイダーと API キー",
  modelsDesc:
    "各 LLM プロバイダー（StepFun、DeepSeek、GLM、Claude、OpenAI、Gemini）の API キーと既定モデルを設定します。デスクトップ版のキーはこの PC に暗号化して保存されます。",
  customTitle: "スキルと記憶",
  customDesc: "エージェントのスキル拡張と、八千代が覚えておく長期記憶を設定します。",
  memoryGroup: "八千代の長期記憶",
  skillsGroup: "スキル拡張",
  browserDesc: "八千代にウェブ検索を許可し、参照元を表示するかどうかを選べます。",
  appTitle: "データ管理とメンテナンス",
  appDesc: "ローカルの IndexedDB キャッシュ、会話の保存、認証情報の削除、バージョン更新を管理します。",
  cleanupGroup: "データの削除",
  clearAllName: "すべての会話を削除",
  clearAllDesc: "IndexedDB に保存されたすべての会話履歴と画像添付のキャッシュを完全に削除します。",
  confirmClear: "削除する",
  cancel: "キャンセル",
  clearData: "データを削除",
  compressName: "コンテキストの圧縮",
  compressDesc: "長い会話履歴を要約してトークン消費を抑えます。",
  compressNow: "今すぐ圧縮",
  signOutName: "サーバー側の認証情報を削除",
  signOutDesc: "この端末がサーバーに保存しているセッション Cookie を削除します。",
  signOut: "認証情報を削除",
  updateGroup: "バージョンと更新",
  updateName: "更新を確認",
  updateIdle: "GitHub Releases から最新の正式版を取得します。",
  updateChecking: "確認中…",
  updateLatest: (version) => `現在のバージョン v${version} は最新です。`,
  updateAvailable: (latest, current) => `新しいバージョン v${latest} があります（現在 v${current}）。`,
  updateFailed: "確認できませんでした。ネットワーク接続を確認してから再試行してください。",
  updateDownload: "ダウンロード",
  shortcutsTitle: "キーボードショートカット",
  shortcutsDesc: "キーボードだけでデスクトップ版を操作するためのショートカット一覧です。",
  globalGroup: "全体操作",
  scNewChat: "新しい会話",
  scSwitchView: "会話 / エディターの切り替え",
  scToggleRightPane: "成果パネルを開く / 閉じる",
  scToggleSidebar: "サイドバーを折りたたむ / 展開",
  scPalette: "コマンドパレット",
  scOpenSettings: "設定を開く",
  scEscape: "ダイアログを閉じる / 操作を取り消す",
  inputGroup: "入力と送信",
  scSend: "メッセージを送信",
  scNewline: "入力欄で改行",
  scSlash: "コマンドメニューを開く",
  userDesc: "ローカルのプロフィール、アバター、ユーザー名を管理します。このページのデータはすべてこの端末のローカルストレージにのみ保存され、クラウドには送信されません。",
  avatarFileLabel: "アバター画像をアップロード",
  profileGroup: "プロフィール (Profile)",
  changeAvatarTitle: "クリックしてアバターを変更",
  changeAvatar: "アバターを変更",
  removeAvatar: "アバターを削除",
  usernameName: "ユーザー名",
  usernameDesc: "表示名を設定します。空欄で保存すると既定のキャラクター名「酒寄彩叶」に戻ります。",
  usernameLabel: "ユーザー名",
  saved: "保存しました",
  saveName: "名前を保存",
  badgeName: "称号 (Badge)",
  badgeDesc: "サイドバーに表示する称号を設定します。プリセット（Lite、Plus、Pro、Go）から選ぶか、自由に入力できます。",
  badgeLabel: "カスタム称号",
  badgePlaceholder: "称号を入力 (例: VIP, Go)",
  saveBadge: "称号を保存",
  storageGroup: "データの安全性とローカル保存",
  storageName: "ローカル専用ストレージ",
  storageDesc:
    "アバター画像とユーザー名はこの端末の LocalStorage にのみ保存されます。クラウドサービスやネットワーク経由で収集・保存されることはありません。",
  localOnly: "ローカルのみ",
};

const SETTINGS_COPY: Readonly<Record<Locale, SettingsCopy>> = { "zh-CN": zhCopy, "ja-JP": jaCopy };

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
  const t = SETTINGS_COPY[shared.controller.locale];
  const desktop = isDesktopApp();
  const [updateCheck, setUpdateCheck] = useState<"idle" | "checking" | "failed" | UpdateCheckResult>("idle");

  const handleCheckUpdate = async () => {
    setUpdateCheck("checking");
    setUpdateCheck((await checkForUpdate()) ?? "failed");
  };

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
    setUsernameDraft(trimmed || t.defaultUsername);
    setUsernameSavedToast(true);
    shared.showToast(trimmed ? t.usernameUpdated(trimmed) : t.usernameReset, "info");
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
    shared.showToast(t.badgeUpdated(finalBadge), "info");
  };

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [rawAvatarSrc, setRawAvatarSrc] = useState<string>("");

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      shared.showToast(t.pickImage, "error");
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
      shared.showToast(t.readImageFailed, "error");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmCropAvatar = (croppedDataUrl: string) => {
    setCropModalOpen(false);
    setRawAvatarSrc("");
    saveUserSettings({ avatar: croppedDataUrl });
    shared.showToast(t.avatarSaved, "info");
  };

  const handleRemoveAvatar = () => {
    saveUserSettings({ avatar: "" });
    shared.showToast(t.avatarReset, "info");
  };

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
    : t.defaultProvider;


  return (
    <div className="settings-modal-overlay" role="dialog" aria-modal="true" aria-label={t.dialogLabel}>
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
          title={t.closeTitle}
          aria-label={t.closeLabel}
        >
          <X size={18} />
        </button>

        {/* ─── 左侧导航栏 ─────────────────────────────── */}
        <nav className="settings-modal__sidebar" aria-label={t.navLabel}>
          <div className="settings-modal__sidebar-header">
            <span className="settings-modal__sidebar-kicker">{t.kicker}</span>
          </div>

          <div className="settings-modal__nav-list" role="tablist">
            {/* 1. 主设置分类 */}
            <div className="settings-modal__nav-group">
              <button
                type="button"
                role="tab"
                aria-label={t.navGeneralLabel}
                aria-selected={activeTab === "general"}
                className={`settings-modal__nav-item ${activeTab === "general" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <Sliders size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navGeneral}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navAppLabel}
                aria-selected={activeTab === "app"}
                className={`settings-modal__nav-item ${activeTab === "app" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("app")}
              >
                <Database size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navApp}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navAppearanceLabel}
                aria-selected={activeTab === "appearance"}
                className={`settings-modal__nav-item ${activeTab === "appearance" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("appearance")}
              >
                <Palette size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navAppearance}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navModelsLabel}
                aria-selected={activeTab === "models"}
                className={`settings-modal__nav-item ${activeTab === "models" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("models")}
              >
                <Cpu size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navModels}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navCustomLabel}
                aria-selected={activeTab === "custom"}
                className={`settings-modal__nav-item ${activeTab === "custom" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("custom")}
              >
                <Sparkles size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navCustom}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navBrowser}
                aria-selected={activeTab === "browser"}
                className={`settings-modal__nav-item ${activeTab === "browser" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("browser")}
              >
                <Globe size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navBrowser}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navMcp}
                aria-selected={activeTab === "mcp"}
                className={`settings-modal__nav-item ${activeTab === "mcp" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("mcp")}
              >
                <Server size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navMcp}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-label={t.navPlugins}
                aria-selected={activeTab === "plugins"}
                className={`settings-modal__nav-item ${activeTab === "plugins" ? "settings-modal__nav-item--active" : ""}`}
                onClick={() => setActiveTab("plugins")}
              >
                <Puzzle size={16} className="settings-modal__nav-icon" />
                <span className="settings-modal__nav-item-text">{t.navPlugins}</span>
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
              <span>{t.shortcutsLink}</span>
            </button>

            <button
              type="button"
              className="settings-modal__sidebar-footer-link"
              onClick={() => {
                void openExternalUrl("https://github.com/liangcka/Yachiyo-chat-desktop");
              }}
            >
              <HelpCircle size={14} />
              <span>{t.feedbackLink}</span>
            </button>

            {/* 左下角用户设置（纯本地保存） */}
            <button
              type="button"
              role="tab"
              aria-label={t.userSettingsLabel}
              aria-selected={activeTab === "user"}
              className={`settings-modal__client-bar settings-modal__user-bar ${activeTab === "user" ? "settings-modal__user-bar--active" : ""}`}
              onClick={() => setActiveTab("user")}
              title={t.userBarTitle}
            >
              <div className="settings-modal__client-icon settings-modal__user-icon">
                {userSettings.avatar ? (
                  <img
                    src={userSettings.avatar}
                    alt={userSettings.username || t.userAvatarAlt}
                    className="settings-modal__user-avatar-thumb"
                  />
                ) : (
                  <User size={14} />
                )}
              </div>
              <div className="settings-modal__client-info">
                <span className="settings-modal__client-title">
                  {userSettings.username || t.defaultUsername}
                </span>
                <span className="settings-modal__client-subtitle">
                  {t.userBarSubtitle}
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
                <h3 className="settings-panel-view__title">{t.navGeneral}</h3>
                <p className="settings-panel-view__desc">{t.generalDesc}</p>
              </div>

              {/* 1. 隐私与数据安全 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.privacyGroup}</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.privacyName}</strong>
                    <span className="settings-item-card__desc">{t.privacyDesc}</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={privacyMode}
                      className={`settings-toggle-switch ${privacyMode ? "settings-toggle-switch--active" : ""}`}
                      onClick={handleTogglePrivacyMode}
                      aria-label={t.privacyToggle}
                    >
                      <span className="settings-toggle-knob" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. 系统运行状态速览 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.statusGroup}</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.llmName}</strong>
                    <span className="settings-item-card__desc">
                      {t.llmActivePrefix}
                      <strong>{currentProviderLabel}</strong>
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("models")}
                    >
                      {t.manageProviders}
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.navBrowser}</strong>
                    <span className="settings-item-card__desc">
                      {t.webSearchPrefix}
                      <strong>{shared.webSearchSettings.enabled ? t.webSearchOn : t.webSearchOff}</strong>
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("browser")}
                    >
                      {t.configureSearch}
                    </button>
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.dbName}</strong>
                    <span className="settings-item-card__desc">
                      {t.dbDescBefore} <strong>{shared.conversations.length}</strong> {t.dbDescAfter}
                    </span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setActiveTab("app")}
                    >
                      {t.dataManage}
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
                <h3 className="settings-panel-view__title">{t.appearanceTitle}</h3>
                <p className="settings-panel-view__desc">{t.appearanceDesc}</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.interfaceGroup}</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.themeName}</strong>
                    <span className="settings-item-card__desc">{t.themeCurrent(resolvedTheme === "dark")}</span>
                  </div>
                  <div className="settings-item-card__action">
                    {onToggleTheme ? (
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={onToggleTheme}
                      >
                        {resolvedTheme === "dark" ? t.toLight : t.toDark}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.languageName}</strong>
                    <span className="settings-item-card__desc">{t.languageCurrent}</span>
                  </div>
                  <div className="settings-item-card__action">
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() =>
                        void shared.onLocale(shared.controller.locale === "zh-CN" ? "ja-JP" : "zh-CN")
                      }
                    >
                      {t.switchLanguage}
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
                <h3 className="settings-panel-view__title">{t.modelsTitle}</h3>
                <p className="settings-panel-view__desc">{t.modelsDesc}</p>
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
                <h3 className="settings-panel-view__title">{t.customTitle}</h3>
                <p className="settings-panel-view__desc">{t.customDesc}</p>
              </div>

              <div className="settings-custom-stack">
                <div className="settings-card-group">
                  <h4 className="settings-card-group__title">{t.memoryGroup}</h4>
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
                  <h4 className="settings-card-group__title">{t.skillsGroup}</h4>
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

          {/* TAB: 联网搜索 */}
          {activeTab === "browser" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">{t.navBrowser}</h3>
                <p className="settings-panel-view__desc">{t.browserDesc}</p>
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

          {/* TAB: MCP 扩展服务 */}
          {activeTab === "mcp" ? (
            <McpPanel showToast={shared.showToast} />
          ) : null}

          {/* TAB: 插件 */}
          {activeTab === "plugins" ? (
            <PluginsPanel
              locale={shared.controller.locale}
              hasDeepSeekKey={shared.llmEntries.some((entry) => entry.provider === "deepseek" && entry.baseUrl === undefined)}
              onConfigureKey={() => setActiveTab("models")}
            />
          ) : null}

          {/* TAB: 存储与维护 (App) */}
          {activeTab === "app" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">{t.appTitle}</h3>
                <p className="settings-panel-view__desc">{t.appDesc}</p>
              </div>

              {desktop ? (
                <div className="settings-card-group">
                  <h4 className="settings-card-group__title">{t.updateGroup}</h4>
                  <div className="settings-item-card">
                    <div className="settings-item-card__lead">
                      <strong className="settings-item-card__name">{t.updateName}</strong>
                      <span className="settings-item-card__desc" aria-live="polite">
                        {updateCheck === "idle" || updateCheck === "checking"
                          ? t.updateIdle
                          : updateCheck === "failed"
                            ? t.updateFailed
                            : updateCheck.available !== undefined
                              ? t.updateAvailable(updateCheck.available.version, updateCheck.currentVersion)
                              : t.updateLatest(updateCheck.currentVersion)}
                      </span>
                    </div>
                    <div className="settings-item-card__action">
                      {typeof updateCheck === "object" && updateCheck.available !== undefined ? (
                        <button
                          type="button"
                          className="settings-btn settings-btn--primary"
                          onClick={() => {
                            if (typeof updateCheck === "object" && updateCheck.available !== undefined) {
                              void openExternalUrl(updateCheck.available.url);
                            }
                          }}
                        >
                          {t.updateDownload}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="settings-btn"
                          disabled={updateCheck === "checking"}
                          onClick={() => void handleCheckUpdate()}
                        >
                          {updateCheck === "checking" ? t.updateChecking : t.updateName}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.cleanupGroup}</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.clearAllName}</strong>
                    <span className="settings-item-card__desc">{t.clearAllDesc}</span>
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
                          {t.confirmClear}
                        </button>
                        <button
                          type="button"
                          className="settings-btn"
                          onClick={() => setShowClearConfirm(false)}
                        >
                          {t.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn settings-btn--danger-text"
                        onClick={() => setShowClearConfirm(true)}
                      >
                        <Trash2 size={13} style={{ display: "inline", marginRight: 4 }} />
                        {t.clearData}
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.compressName}</strong>
                    <span className="settings-item-card__desc">{t.compressDesc}</span>
                  </div>
                  <div className="settings-item-card__action">
                    {onCompress ? (
                      <button type="button" className="settings-btn" onClick={onCompress}>
                        {t.compressNow}
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* 桌面端由本地网关鉴权，不存在服务端会话 Cookie */}
                {desktop ? null : (
                  <div className="settings-item-card">
                    <div className="settings-item-card__lead">
                      <strong className="settings-item-card__name">{t.signOutName}</strong>
                      <span className="settings-item-card__desc">{t.signOutDesc}</span>
                    </div>
                    <div className="settings-item-card__action">
                      <button
                        type="button"
                        className="settings-btn settings-btn--ghost"
                        onClick={() => void shared.onSignOut()}
                      >
                        {t.signOut}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* TAB: 快捷键速查 (Shortcuts) */}
          {activeTab === "shortcuts" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">{t.shortcutsTitle}</h3>
                <p className="settings-panel-view__desc">{t.shortcutsDesc}</p>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.globalGroup}</h4>
                <div className="settings-shortcut-table">
                  {(
                    [
                      [t.scNewChat, "Ctrl + N"],
                      [t.scSwitchView, "Ctrl + 1 / 2"],
                      [t.scToggleRightPane, "Ctrl + B"],
                      [t.scToggleSidebar, "Ctrl + ["],
                      [t.scPalette, "Ctrl + K"],
                      [t.scOpenSettings, "Ctrl + ,"],
                      [t.scEscape, "Esc"],
                    ] as const
                  ).map(([name, keys]) => (
                    <div className="settings-shortcut-row" key={keys}>
                      <span className="settings-shortcut-name">{name}</span>
                      <kbd className="settings-kbd">{keys}</kbd>
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.inputGroup}</h4>
                <div className="settings-shortcut-table">
                  {(
                    [
                      [t.scSend, "Enter"],
                      [t.scNewline, "Shift + Enter"],
                      [t.scSlash, "/"],
                    ] as const
                  ).map(([name, keys]) => (
                    <div className="settings-shortcut-row" key={keys}>
                      <span className="settings-shortcut-name">{name}</span>
                      <kbd className="settings-kbd">{keys}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB: 用户设置 (User - 纯本地保存) */}
          {activeTab === "user" ? (
            <div className="settings-panel-view">
              <div className="settings-panel-view__header">
                <h3 className="settings-panel-view__title">{t.userSettingsLabel}</h3>
                <p className="settings-panel-view__desc">{t.userDesc}</p>
              </div>

              {/* 隐藏的本地头像文件选择器 */}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                aria-label={t.avatarFileLabel}
                style={{ display: "none" }}
                onChange={handleAvatarFileChange}
              />

              {/* 1. 个人资料卡片：头像与用户名 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.profileGroup}</h4>
                <div className="settings-item-card settings-user-profile-card">
                  <div className="settings-user-profile-layout">
                    <div className="settings-user-profile-avatar-col">
                      <div className="settings-user-avatar-wrapper">
                        {userSettings.avatar ? (
                          <img
                            src={userSettings.avatar}
                            alt={userSettings.username || t.userAvatarAlt}
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
                          title={t.changeAvatarTitle}
                          aria-label={t.changeAvatar}
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
                          {t.changeAvatar}
                        </button>
                        {userSettings.avatar ? (
                          <button
                            type="button"
                            className="settings-btn settings-btn--ghost settings-btn--sm danger-action"
                            onClick={handleRemoveAvatar}
                          >
                            {t.removeAvatar}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="settings-user-profile-info-col">
                      <div className="settings-item-card__lead">
                        <strong className="settings-item-card__name">{t.usernameName}</strong>
                        <span className="settings-item-card__desc">{t.usernameDesc}</span>
                      </div>

                      <div className="settings-user-input-row">
                        <input
                          type="text"
                          aria-label={t.usernameLabel}
                          className="settings-user-input"
                          placeholder={t.defaultUsername}
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
                              {t.saved}
                            </>
                          ) : (
                            t.saveName
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 身份称号与等级设置 */}
                <div className="settings-item-card settings-user-badge-card" style={{ marginTop: 12 }}>
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.badgeName}</strong>
                    <span className="settings-item-card__desc">{t.badgeDesc}</span>
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
                        aria-label={t.badgeLabel}
                        className="settings-user-input"
                        placeholder={t.badgePlaceholder}
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
                        {t.saveBadge}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. 本地隐私隔离保证 */}
              <div className="settings-card-group">
                <h4 className="settings-card-group__title">{t.storageGroup}</h4>
                <div className="settings-item-card">
                  <div className="settings-item-card__lead">
                    <strong className="settings-item-card__name">{t.storageName}</strong>
                    <span className="settings-item-card__desc">{t.storageDesc}</span>
                  </div>
                  <div className="settings-item-card__action">
                    <span className="settings-user-storage-badge">{t.localOnly}</span>
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
