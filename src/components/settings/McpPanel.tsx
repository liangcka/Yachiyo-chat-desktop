import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import type { Locale } from "../../domain/chat";
import { useLocale } from "../../i18n/locale-context";
import {
  BUILTIN_DESKTOP_CONTROL_ID,
  deleteMcpServer,
  exportClaudeMcpConfig,
  importClaudeMcpConfig,
  listMcpServers,
  MCP_PRESETS,
  type McpPreset,
  type McpServerConfig,
  type McpTool,
  saveMcpServer,
  testMcpServer,
  toggleMcpServer,
} from "../../services/mcp-manager";

export interface McpPanelProps {
  showToast?: (message: string, tone?: "info" | "error") => void;
}

interface EditModalState {
  open: boolean;
  isNew: boolean;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transportType: "stdio" | "sse";
  command: string;
  argsText: string;
  envText: string;
  url: string;
}

const INITIAL_EDIT_STATE: EditModalState = {
  open: false,
  isNew: true,
  id: "",
  name: "",
  description: "",
  enabled: true,
  transportType: "stdio",
  command: "",
  argsText: "",
  envText: "",
  url: "",
};

const zhCopy = {
  loadFailed: (error: string) => `加载 MCP 服务列表失败: ${error}`,
  enabled: (id: string) => `服务「${id}」已启用`,
  disabled: (id: string) => `服务「${id}」已禁用`,
  toggleFailed: (id: string) => `更新服务「${id}」状态失败`,
  confirmDelete: (name: string) => `确认删除 MCP 服务「${name}」吗？`,
  deleted: (name: string) => `服务「${name}」已删除`,
  deleteFailed: (id: string) => `删除服务「${id}」失败`,
  connected: (count: number) => `连接成功！发现 ${count} 个工具`,
  testFailedDefault: "连接测试失败",
  connectFailed: (error: string) => `连接失败: ${error}`,
  connectError: (error: string) => `连接出错: ${error}`,
  idRequired: "服务 ID 不能为空",
  idInvalid: "服务 ID 仅支持英文字母、数字、下划线与连字符",
  idReserved: "该 ID 由内置电脑控制使用，请在「插件」页开关电脑控制",
  commandRequired: "请输入执行命令（例如 npx, uvx 等）",
  urlRequired: "请输入远程 SSE / HTTP 服务端点 URL",
  testPassed: (count: number) => `连接测试成功！发现 ${count} 个工具`,
  testFailed: (error: string) => `连接测试失败: ${error}`,
  unknownError: "未知错误",
  testError: (error: string) => `测试出错: ${error}`,
  saved: (name: string) => `MCP 服务「${name}」已保存`,
  saveFailed: "保存 MCP 服务失败",
  exportFailed: "导出配置失败",
  exported: "已将 Claude Desktop 格式配置复制到剪贴板！",
  clipboardFailed: "复制到剪贴板失败，请允许剪贴板访问权限",
  importEmpty: "请输入要导入的 JSON 内容",
  imported: (count: number) => `导入成功！共导入 ${count} 个服务配置`,
  importFailed: (error: string) => `导入失败: ${error}`,
  invalidFormat: "格式不合法",
  title: "MCP 扩展服务 (Model Context Protocol)",
  description: "基于开放 MCP 标准连接外部工具与数据源。八千代在多轮思考中可自主调用这些服务提供的专业能力。",
  addServer: "添加 MCP 服务",
  importTitle: "支持导入 Claude Desktop (claude_desktop_config.json) 格式配置",
  importJson: "从 JSON 导入",
  exportTitle: "复制当前配置为 Claude Desktop 格式 JSON",
  exportConfig: "导出配置",
  refreshTitle: "刷新配置列表",
  refresh: "刷新",
  configuredBefore: "已配置",
  configuredMiddle: "个服务 · 已启用",
  configuredAfter: "个",
  presetsTitle: "常用 MCP 服务预设模版（一键填入）",
  listTitle: "已配置的 MCP 服务器",
  loading: "正在加载 MCP 服务列表...",
  emptyTitle: "暂未配置任何 MCP 服务",
  emptyDesc: "点击上方「常用 MCP 服务预设模版」快速体验 SQLite 查询或网页抓取，或从 Claude Desktop 配置中导入。",
  addFirst: "添加首个 MCP 服务",
  testTitle: "测试连接并获取工具列表",
  testConnection: "测试连接",
  edit: "编辑",
  deleteTitle: "删除服务",
  toggleLabel: (name: string) => `切换服务 ${name} 状态`,
  toolsBefore: "已发现",
  toolsAfter: "个工具能力",
  editTitle: "编辑 MCP 服务",
  transportLabel: "传输协议类型",
  transportStdio: "本地命令行进程 (stdio)",
  transportSse: "远程端点 (SSE / HTTP)",
  idLabel: "服务 ID（必填，仅限字母数字下划线，作为工具命名空间）",
  idPlaceholder: "例如: sqlite, fetch, my_server",
  nameLabel: "显示名称",
  namePlaceholder: "例如: 本地 SQLite 数据库",
  descLabel: "描述说明（可选）",
  descPlaceholder: "简要描述该服务提供的能力...",
  commandLabel: "执行程序 / 命令 (Command)",
  commandPlaceholder: "例如: uvx, npx, python, node",
  argsLabel: "参数 (Arguments，空格分隔)",
  argsPlaceholder: "例如: mcp-server-sqlite --db-path ./test.db",
  envLabel: "环境变量 (Environment，每行 KEY=VALUE)",
  urlLabel: "服务 URL (Server Endpoint)",
  urlPlaceholder: "例如: http://127.0.0.1:8000/sse",
  modalPassed: (count: number) => `测试通过！已成功发现 ${count} 个工具。`,
  modalFailed: (error: string) => `连接失败: ${error}`,
  cancel: "取消",
  saveServer: "保存服务",
  importModalTitle: "从 JSON 导入 MCP 配置",
  importHintBefore: "可直接粘贴 Claude Desktop 的",
  importHintMiddle: "（包含",
  importHintAfter: "字段）配置内容：",
  confirmImport: "确认导入",
};

type McpCopy = typeof zhCopy;

const jaCopy: McpCopy = {
  loadFailed: (error) => `MCP サーバー一覧を読み込めませんでした: ${error}`,
  enabled: (id) => `サーバー「${id}」を有効にしました`,
  disabled: (id) => `サーバー「${id}」を無効にしました`,
  toggleFailed: (id) => `サーバー「${id}」の状態を更新できませんでした`,
  confirmDelete: (name) => `MCP サーバー「${name}」を削除しますか？`,
  deleted: (name) => `サーバー「${name}」を削除しました`,
  deleteFailed: (id) => `サーバー「${id}」を削除できませんでした`,
  connected: (count) => `接続に成功しました。ツールが ${count} 個見つかりました`,
  testFailedDefault: "接続テストに失敗しました",
  connectFailed: (error) => `接続に失敗しました: ${error}`,
  connectError: (error) => `接続中にエラーが発生しました: ${error}`,
  idRequired: "サーバー ID を入力してください",
  idInvalid: "サーバー ID には英数字、アンダースコア、ハイフンのみ使用できます",
  idReserved: "この ID は内蔵のパソコン操作で使用しています。「プラグイン」でオン／オフを切り替えてください",
  commandRequired: "実行コマンドを入力してください（例: npx, uvx）",
  urlRequired: "リモートの SSE / HTTP エンドポイント URL を入力してください",
  testPassed: (count) => `接続テストに成功しました。ツールが ${count} 個見つかりました`,
  testFailed: (error) => `接続テストに失敗しました: ${error}`,
  unknownError: "不明なエラー",
  testError: (error) => `テスト中にエラーが発生しました: ${error}`,
  saved: (name) => `MCP サーバー「${name}」を保存しました`,
  saveFailed: "MCP サーバーを保存できませんでした",
  exportFailed: "設定をエクスポートできませんでした",
  exported: "Claude Desktop 形式の設定をクリップボードにコピーしました",
  clipboardFailed: "クリップボードにコピーできませんでした。クリップボードへのアクセスを許可してください",
  importEmpty: "インポートする JSON を入力してください",
  imported: (count) => `インポートしました。サーバー設定 ${count} 件を追加しました`,
  importFailed: (error) => `インポートに失敗しました: ${error}`,
  invalidFormat: "形式が正しくありません",
  title: "MCP 拡張サーバー (Model Context Protocol)",
  description: "オープンな MCP 規格で外部ツールやデータソースに接続します。八千代は考えながらこれらのサーバーの機能を自分で呼び出せます。",
  addServer: "MCP サーバーを追加",
  importTitle: "Claude Desktop（claude_desktop_config.json）形式の設定をインポートできます",
  importJson: "JSON からインポート",
  exportTitle: "現在の設定を Claude Desktop 形式の JSON としてコピー",
  exportConfig: "設定をエクスポート",
  refreshTitle: "設定一覧を更新",
  refresh: "更新",
  configuredBefore: "設定済み",
  configuredMiddle: "件 · 有効",
  configuredAfter: "件",
  presetsTitle: "よく使う MCP サーバーのテンプレート（ワンクリックで入力）",
  listTitle: "設定済みの MCP サーバー",
  loading: "MCP サーバー一覧を読み込み中…",
  emptyTitle: "MCP サーバーはまだ設定されていません",
  emptyDesc: "上の「よく使う MCP サーバーのテンプレート」から SQLite の検索やウェブ取得を試すか、Claude Desktop の設定をインポートしてください。",
  addFirst: "最初の MCP サーバーを追加",
  testTitle: "接続をテストしてツール一覧を取得",
  testConnection: "接続テスト",
  edit: "編集",
  deleteTitle: "サーバーを削除",
  toggleLabel: (name) => `サーバー ${name} の有効状態を切り替え`,
  toolsBefore: "見つかったツール：",
  toolsAfter: "個",
  editTitle: "MCP サーバーを編集",
  transportLabel: "通信方式",
  transportStdio: "ローカルのコマンドプロセス (stdio)",
  transportSse: "リモートエンドポイント (SSE / HTTP)",
  idLabel: "サーバー ID（必須。英数字とアンダースコアのみ。ツールの名前空間になります）",
  idPlaceholder: "例: sqlite, fetch, my_server",
  nameLabel: "表示名",
  namePlaceholder: "例: ローカル SQLite データベース",
  descLabel: "説明（任意）",
  descPlaceholder: "このサーバーが提供する機能を簡単に説明…",
  commandLabel: "実行プログラム / コマンド (Command)",
  commandPlaceholder: "例: uvx, npx, python, node",
  argsLabel: "引数 (Arguments、スペース区切り)",
  argsPlaceholder: "例: mcp-server-sqlite --db-path ./test.db",
  envLabel: "環境変数 (Environment、1 行に KEY=VALUE)",
  urlLabel: "サーバー URL (Server Endpoint)",
  urlPlaceholder: "例: http://127.0.0.1:8000/sse",
  modalPassed: (count) => `テストに成功しました。ツールが ${count} 個見つかりました。`,
  modalFailed: (error) => `接続に失敗しました: ${error}`,
  cancel: "キャンセル",
  saveServer: "サーバーを保存",
  importModalTitle: "JSON から MCP 設定をインポート",
  importHintBefore: "Claude Desktop の",
  importHintMiddle: "（",
  importHintAfter: "フィールドを含む）の内容をそのまま貼り付けられます：",
  confirmImport: "インポート",
};

const MCP_COPY: Readonly<Record<Locale, McpCopy>> = { "zh-CN": zhCopy, "ja-JP": jaCopy };

/** 内置电脑控制在「插件」页启停，MCP 面板只管理用户自行添加的服务 */
function isUserServer(server: McpServerConfig): boolean {
  return server.id !== BUILTIN_DESKTOP_CONTROL_ID;
}

export const McpPanel: React.FC<McpPanelProps> = ({ showToast }) => {
  const locale = useLocale();
  const labels = MCP_COPY[locale];
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [serverToolsMap, setServerToolsMap] = useState<Record<string, McpTool[]>>({});
  const [serverTestErrorMap, setServerTestErrorMap] = useState<Record<string, string>>({});

  // 模态弹窗状态
  const [editModal, setEditModal] = useState<EditModalState>(INITIAL_EDIT_STATE);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importJsonText, setImportJsonText] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [modalTesting, setModalTesting] = useState<boolean>(false);
  const [modalTestResult, setModalTestResult] = useState<{
    success: boolean;
    tools?: McpTool[];
    error?: string;
  } | null>(null);

  const notify = React.useCallback(
    (msg: string, tone: "info" | "error" = "info") => {
      if (showToast) {
        showToast(msg, tone);
      } else {
        console.log(`[Toast ${tone}]: ${msg}`);
      }
    },
    [showToast],
  );

  const reloadServers = async () => {
    setLoading(true);
    try {
      const list = await listMcpServers();
      setServers(list.filter(isUserServer));
    } catch (e) {
      notify(labels.loadFailed(String(e)), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listMcpServers();
        if (cancelled) return;
        setServers(list.filter(isUserServer));
      } catch (e) {
        if (cancelled) return;
        notify(labels.loadFailed(String(e)), "error");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labels, notify]);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    const nextEnabled = !currentEnabled;
    const ok = await toggleMcpServer(id, nextEnabled);
    if (ok) {
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled: nextEnabled } : s)),
      );
      notify(nextEnabled ? labels.enabled(id) : labels.disabled(id), "info");
    } else {
      notify(labels.toggleFailed(id), "error");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(labels.confirmDelete(name || id))) {
      return;
    }
    const ok = await deleteMcpServer(id);
    if (ok) {
      setServers((prev) => prev.filter((s) => s.id !== id));
      notify(labels.deleted(name || id), "info");
    } else {
      notify(labels.deleteFailed(id), "error");
    }
  };

  const handleTestServer = async (config: McpServerConfig) => {
    setTestingId(config.id);
    setServerTestErrorMap((prev) => {
      const copy = { ...prev };
      delete copy[config.id];
      return copy;
    });

    try {
      const res = await testMcpServer(config);
      if (res.success && res.tools) {
        setServerToolsMap((prev) => ({ ...prev, [config.id]: res.tools! }));
        setExpandedServerId(config.id);
        notify(labels.connected(res.tools.length), "info");
      } else {
        const errMsg = res.error || labels.testFailedDefault;
        setServerTestErrorMap((prev) => ({ ...prev, [config.id]: errMsg }));
        notify(labels.connectFailed(errMsg), "error");
      }
    } catch (e) {
      const errMsg = String(e);
      setServerTestErrorMap((prev) => ({ ...prev, [config.id]: errMsg }));
      notify(labels.connectError(errMsg), "error");
    } finally {
      setTestingId(null);
    }
  };

  const handleOpenAddModal = () => {
    setModalTestResult(null);
    setEditModal({
      ...INITIAL_EDIT_STATE,
      open: true,
      isNew: true,
    });
  };

  const handleOpenEditModal = (s: McpServerConfig) => {
    setModalTestResult(null);
    let command = "";
    let argsText = "";
    let envText = "";
    let url = "";

    if (s.transport.type === "stdio") {
      command = s.transport.command;
      argsText = s.transport.args.join(" ");
      envText = Object.entries(s.transport.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    } else {
      url = s.transport.url;
    }

    setEditModal({
      open: true,
      isNew: false,
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      enabled: s.enabled,
      transportType: s.transport.type,
      command,
      argsText,
      envText,
      url,
    });
  };

  const handleApplyPreset = (preset: McpPreset) => {
    setModalTestResult(null);
    let command = "";
    let argsText = "";
    let envText = "";
    let url = "";

    if (preset.config.transport.type === "stdio") {
      command = preset.config.transport.command;
      argsText = preset.config.transport.args.join(" ");
      envText = Object.entries(preset.config.transport.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    } else {
      url = preset.config.transport.url;
    }

    setEditModal({
      open: true,
      isNew: true,
      id: preset.config.id,
      name: preset.config.name,
      description: preset.config.description ?? "",
      enabled: true,
      transportType: preset.config.transport.type,
      command,
      argsText,
      envText,
      url,
    });
  };

  const buildConfigFromModal = (): McpServerConfig | null => {
    const trimmedId = editModal.id.trim();
    if (!trimmedId) {
      notify(labels.idRequired, "error");
      return null;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
      notify(labels.idInvalid, "error");
      return null;
    }
    if (trimmedId === BUILTIN_DESKTOP_CONTROL_ID) {
      notify(labels.idReserved, "error");
      return null;
    }

    const trimmedName = editModal.name.trim() || trimmedId;

    if (editModal.transportType === "stdio") {
      const trimmedCommand = editModal.command.trim();
      if (!trimmedCommand) {
        notify(labels.commandRequired, "error");
        return null;
      }
      const args = editModal.argsText
        .split(/\s+/)
        .map((a) => a.trim())
        .filter(Boolean);

      const env: Record<string, string> = {};
      const envLines = editModal.envText.split("\n");
      for (const line of envLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim();
          if (k) env[k] = v;
        }
      }

      return {
        id: trimmedId,
        name: trimmedName,
        description: editModal.description.trim() || undefined,
        enabled: editModal.enabled,
        transport: {
          type: "stdio",
          command: trimmedCommand,
          args,
          env,
        },
      };
    } else {
      const trimmedUrl = editModal.url.trim();
      if (!trimmedUrl) {
        notify(labels.urlRequired, "error");
        return null;
      }
      return {
        id: trimmedId,
        name: trimmedName,
        description: editModal.description.trim() || undefined,
        enabled: editModal.enabled,
        transport: {
          type: "sse",
          url: trimmedUrl,
        },
      };
    }
  };

  const handleModalTest = async () => {
    const cfg = buildConfigFromModal();
    if (!cfg) return;

    setModalTesting(true);
    setModalTestResult(null);
    try {
      const res = await testMcpServer(cfg);
      setModalTestResult(res);
      if (res.success && res.tools) {
        notify(labels.testPassed(res.tools.length), "info");
      } else {
        notify(labels.testFailed(res.error ?? labels.unknownError), "error");
      }
    } catch (e) {
      setModalTestResult({ success: false, error: String(e) });
      notify(labels.testError(String(e)), "error");
    } finally {
      setModalTesting(false);
    }
  };

  const handleSaveModal = async () => {
    const cfg = buildConfigFromModal();
    if (!cfg) return;

    const ok = await saveMcpServer(cfg);
    if (ok) {
      notify(labels.saved(cfg.name), "info");
      setEditModal(INITIAL_EDIT_STATE);
      void reloadServers();
    } else {
      notify(labels.saveFailed, "error");
    }
  };

  const handleExportConfig = async () => {
    const jsonStr = await exportClaudeMcpConfig();
    if (!jsonStr) {
      notify(labels.exportFailed, "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(jsonStr);
      notify(labels.exported, "info");
    } catch {
      notify(labels.clipboardFailed, "error");
    }
  };

  const handleImportConfig = async () => {
    const text = importJsonText.trim();
    if (!text) {
      notify(labels.importEmpty, "error");
      return;
    }
    setIsImporting(true);
    try {
      const res = await importClaudeMcpConfig(text);
      if (res.success) {
        notify(labels.imported(res.count ?? 0), "info");
        setImportModalOpen(false);
        setImportJsonText("");
        void reloadServers();
      } else {
        notify(labels.importFailed(res.error ?? labels.invalidFormat), "error");
      }
    } catch (e) {
      notify(labels.importFailed(String(e)), "error");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="settings-panel-view settings-panel-view--mcp">
      {/* 顶部标题与说明 */}
      <div className="settings-panel-view__header">
        <h3 className="settings-panel-view__title">{labels.title}</h3>
        <p className="settings-panel-view__desc">{labels.description}</p>
      </div>

      {/* 顶部操作工具栏 */}
      <div className="settings-card-group" style={{ marginBottom: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={handleOpenAddModal}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Plus size={14} />
              <span>{labels.addServer}</span>
            </button>

            <button
              type="button"
              className="settings-btn"
              onClick={() => setImportModalOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title={labels.importTitle}
            >
              <Upload size={14} />
              <span>{labels.importJson}</span>
            </button>

            <button
              type="button"
              className="settings-btn"
              onClick={handleExportConfig}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title={labels.exportTitle}
            >
              <Download size={14} />
              <span>{labels.exportConfig}</span>
            </button>

            <button
              type="button"
              className="settings-btn"
              onClick={reloadServers}
              disabled={loading}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title={labels.refreshTitle}
            >
              <RefreshCw size={14} className={loading ? "spin-animate" : ""} />
              <span>{labels.refresh}</span>
            </button>
          </div>

          <div style={{ fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }}>
            {labels.configuredBefore} <strong>{servers.length}</strong> {labels.configuredMiddle}{" "}
            <strong style={{ color: "var(--accent-brand, #3b82f6)" }}>
              {servers.filter((s) => s.enabled).length}
            </strong>{" "}
            {labels.configuredAfter}
          </div>
        </div>
      </div>

      {/* 快捷模版预设区 */}
      <div className="settings-card-group" style={{ marginBottom: "16px" }}>
        <h4 className="settings-card-group__title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Sparkles size={14} style={{ color: "var(--accent-brand, #3b82f6)" }} />
          <span>{labels.presetsTitle}</span>
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "8px",
            marginTop: "6px",
          }}
        >
          {MCP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="settings-btn"
              onClick={() => handleApplyPreset(preset)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "10px 12px",
                height: "auto",
                textAlign: "left",
                background: "var(--dsw-alias-bg-layer-2)",
                border: "1px solid var(--dsw-alias-border-l1)",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                <span style={{ fontWeight: 600, fontSize: "12.5px", color: "var(--dsw-alias-label-primary)" }}>
                  {locale === "ja-JP" ? preset.ja.name : preset.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "10px",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "var(--accent-brand, #3b82f6)",
                  }}
                >
                  {preset.config.transport.type}
                </span>
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--dsw-alias-label-secondary)",
                  marginTop: "4px",
                  lineHeight: "1.3",
                }}
              >
                {locale === "ja-JP" ? preset.ja.description : preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 服务列表 */}
      <div className="settings-card-group">
        <h4 className="settings-card-group__title">{labels.listTitle}</h4>

        {loading ? (
          <div
            style={{
              padding: "30px",
              textAlign: "center",
              color: "var(--dsw-alias-label-secondary)",
              fontSize: "13px",
            }}
          >
            <Loader2 size={18} className="spin-animate" style={{ margin: "0 auto 8px" }} />
            {labels.loading}
          </div>
        ) : servers.length === 0 ? (
          <div
            style={{
              padding: "36px 20px",
              textAlign: "center",
              background: "var(--dsw-alias-bg-layer-2)",
              borderRadius: "10px",
              border: "1px dashed var(--dsw-alias-border-l1)",
            }}
          >
            <Server size={32} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
            <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" }}>
              {labels.emptyTitle}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--dsw-alias-label-secondary)",
                marginTop: "4px",
                maxWidth: "380px",
                margin: "4px auto 14px",
              }}
            >
              {labels.emptyDesc}
            </div>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={handleOpenAddModal}
            >
              <Plus size={14} />
              <span>{labels.addFirst}</span>
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "6px" }}>
            {servers.map((s) => {
              const isTesting = testingId === s.id;
              const tools = serverToolsMap[s.id] ?? [];
              const testErr = serverTestErrorMap[s.id];
              const isExpanded = expandedServerId === s.id;

              return (
                <div
                  key={s.id}
                  style={{
                    borderRadius: "10px",
                    background: "var(--dsw-alias-bg-layer-2)",
                    border: "1px solid var(--dsw-alias-border-l1)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      gap: "12px",
                    }}
                  >
                    {/* 左侧信息 */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          marginTop: "6px",
                          flexShrink: 0,
                          background: !s.enabled
                            ? "var(--dsw-alias-label-tertiary)"
                            : testErr
                              ? "#ef4444"
                              : tools.length > 0
                                ? "#10b981"
                                : "var(--accent-brand, #3b82f6)",
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <strong
                            style={{
                              fontSize: "13.5px",
                              fontWeight: 600,
                              color: "var(--dsw-alias-label-primary)",
                            }}
                          >
                            {s.name}
                          </strong>
                          <span
                            style={{
                              fontSize: "11px",
                              fontFamily: "var(--font-mono, monospace)",
                              color: "var(--dsw-alias-label-tertiary)",
                            }}
                          >
                            ID: {s.id}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontWeight: 500,
                              background:
                                s.transport.type === "stdio"
                                  ? "rgba(139, 92, 246, 0.15)"
                                  : "rgba(16, 185, 129, 0.15)",
                              color:
                                s.transport.type === "stdio"
                                  ? "#8b5cf6"
                                  : "#10b981",
                            }}
                          >
                            {s.transport.type.toUpperCase()}
                          </span>
                        </div>

                        {s.description && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--dsw-alias-label-secondary)",
                              lineHeight: "1.4",
                            }}
                          >
                            {s.description}
                          </div>
                        )}

                        <div
                          style={{
                            fontSize: "11px",
                            fontFamily: "var(--font-mono, monospace)",
                            color: "var(--dsw-alias-label-tertiary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: "2px",
                          }}
                        >
                          {s.transport.type === "stdio"
                            ? `${s.transport.command} ${s.transport.args.join(" ")}`
                            : s.transport.url}
                        </div>

                        {testErr && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#ef4444",
                              marginTop: "2px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <AlertCircle size={12} />
                            <span>{testErr}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 右侧操作按钮 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => handleTestServer(s)}
                        disabled={isTesting}
                        style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px" }}
                        title={labels.testTitle}
                      >
                        {isTesting ? (
                          <Loader2 size={13} className="spin-animate" />
                        ) : (
                          <Play size={13} />
                        )}
                        <span style={{ fontSize: "11.5px" }}>{labels.testConnection}</span>
                      </button>

                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => handleOpenEditModal(s)}
                        style={{ padding: "4px 8px", fontSize: "11.5px" }}
                      >
                        {labels.edit}
                      </button>

                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => handleDelete(s.id, s.name)}
                        style={{ padding: "4px 6px", color: "var(--dsw-alias-label-tertiary)" }}
                        title={labels.deleteTitle}
                      >
                        <Trash2 size={13} />
                      </button>

                      {/* 启停开关 */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.enabled}
                        className={`settings-toggle-switch ${s.enabled ? "settings-toggle-switch--active" : ""}`}
                        onClick={() => handleToggle(s.id, s.enabled)}
                        aria-label={labels.toggleLabel(s.name)}
                      >
                        <span className="settings-toggle-knob" />
                      </button>
                    </div>
                  </div>

                  {/* 工具列表展开入口 */}
                  {tools.length > 0 && (
                    <div
                      style={{
                        borderTop: "1px solid var(--dsw-alias-border-l1)",
                        padding: "6px 16px",
                        background: "rgba(0, 0, 0, 0.03)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedServerId(isExpanded ? null : s.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          width: "100%",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--dsw-alias-label-secondary)",
                          fontSize: "11.5px",
                          padding: "2px 0",
                        }}
                      >
                        <Wrench size={12} />
                        <span>{labels.toolsBefore} <strong>{tools.length}</strong> {labels.toolsAfter}</span>
                        {isExpanded ? <ChevronUp size={13} style={{ marginLeft: "auto" }} /> : <ChevronDown size={13} style={{ marginLeft: "auto" }} />}
                      </button>

                      {isExpanded && (
                        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                          {tools.map((t) => (
                            <div
                              key={t.name}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "6px",
                                background: "var(--dsw-alias-bg-layer-1)",
                                border: "1px solid var(--dsw-alias-border-l1)",
                                fontSize: "11.5px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <strong style={{ color: "var(--accent-brand, #3b82f6)", fontFamily: "monospace" }}>
                                  mcp__{s.id}__{t.name}
                                </strong>
                              </div>
                              {t.description && (
                                <div style={{ color: "var(--dsw-alias-label-secondary)", marginTop: "2px", fontSize: "11px" }}>
                                  {t.description}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 添加 / 编辑服务模态框 ─────────────────── */}
      {editModal.open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "520px",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--dsw-alias-bg-base)",
              borderRadius: "12px",
              border: "1px solid var(--dsw-alias-border-l1)",
              padding: "22px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" }}>
                {editModal.isNew ? labels.addServer : labels.editTitle}
              </h3>
              <button
                type="button"
                className="settings-link-btn"
                onClick={() => setEditModal(INITIAL_EDIT_STATE)}
                style={{ padding: "4px" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* 协议类型切换 */}
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "6px" }}>
                {labels.transportLabel}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className={`settings-btn ${editModal.transportType === "stdio" ? "settings-btn--primary" : ""}`}
                  onClick={() => setEditModal((prev) => ({ ...prev, transportType: "stdio" }))}
                  style={{ flex: 1, padding: "8px" }}
                >
                  <Terminal size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                  {labels.transportStdio}
                </button>
                <button
                  type="button"
                  className={`settings-btn ${editModal.transportType === "sse" ? "settings-btn--primary" : ""}`}
                  onClick={() => setEditModal((prev) => ({ ...prev, transportType: "sse" }))}
                  style={{ flex: 1, padding: "8px" }}
                >
                  <Server size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                  {labels.transportSse}
                </button>
              </div>
            </div>

            {/* 服务唯一 ID */}
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                {labels.idLabel}
              </div>
              <input
                type="text"
                value={editModal.id}
                disabled={!editModal.isNew}
                onChange={(e) => setEditModal((prev) => ({ ...prev, id: e.target.value }))}
                placeholder={labels.idPlaceholder}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--dsw-alias-border-l1)",
                  background: "var(--dsw-alias-bg-layer-2)",
                  color: "var(--dsw-alias-label-primary)",
                  fontSize: "12.5px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* 服务显示名称 */}
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                {labels.nameLabel}
              </div>
              <input
                type="text"
                value={editModal.name}
                onChange={(e) => setEditModal((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={labels.namePlaceholder}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--dsw-alias-border-l1)",
                  background: "var(--dsw-alias-bg-layer-2)",
                  color: "var(--dsw-alias-label-primary)",
                  fontSize: "12.5px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* 描述信息 */}
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                {labels.descLabel}
              </div>
              <input
                type="text"
                value={editModal.description}
                onChange={(e) => setEditModal((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={labels.descPlaceholder}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--dsw-alias-border-l1)",
                  background: "var(--dsw-alias-bg-layer-2)",
                  color: "var(--dsw-alias-label-primary)",
                  fontSize: "12.5px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* stdio 表单项 */}
            {editModal.transportType === "stdio" ? (
              <>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                    {labels.commandLabel}
                  </div>
                  <input
                    type="text"
                    value={editModal.command}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, command: e.target.value }))}
                    placeholder={labels.commandPlaceholder}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--dsw-alias-border-l1)",
                      background: "var(--dsw-alias-bg-layer-2)",
                      color: "var(--dsw-alias-label-primary)",
                      fontSize: "12.5px",
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                    {labels.argsLabel}
                  </div>
                  <input
                    type="text"
                    value={editModal.argsText}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, argsText: e.target.value }))}
                    placeholder={labels.argsPlaceholder}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--dsw-alias-border-l1)",
                      background: "var(--dsw-alias-bg-layer-2)",
                      color: "var(--dsw-alias-label-primary)",
                      fontSize: "12.5px",
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                    {labels.envLabel}
                  </div>
                  <textarea
                    rows={2}
                    value={editModal.envText}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, envText: e.target.value }))}
                    placeholder="API_KEY=xxx&#10;PORT=8080"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--dsw-alias-border-l1)",
                      background: "var(--dsw-alias-bg-layer-2)",
                      color: "var(--dsw-alias-label-primary)",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </>
            ) : (
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                  {labels.urlLabel}
                </div>
                <input
                  type="text"
                  value={editModal.url}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, url: e.target.value }))}
                  placeholder={labels.urlPlaceholder}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--dsw-alias-border-l1)",
                    background: "var(--dsw-alias-bg-layer-2)",
                    color: "var(--dsw-alias-label-primary)",
                    fontSize: "12.5px",
                    fontFamily: "monospace",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}

            {/* 测试结果提示 */}
            {modalTestResult && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  background: modalTestResult.success ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
                  color: modalTestResult.success ? "#10b981" : "#ef4444",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {modalTestResult.success ? (
                  <>
                    <Check size={14} />
                    <span>{labels.modalPassed(modalTestResult.tools?.length ?? 0)}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={14} />
                    <span>{labels.modalFailed(modalTestResult.error ?? labels.unknownError)}</span>
                  </>
                )}
              </div>
            )}

            {/* 底部按钮栏 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px" }}>
              <button
                type="button"
                className="settings-btn"
                onClick={handleModalTest}
                disabled={modalTesting}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                {modalTesting ? <Loader2 size={13} className="spin-animate" /> : <Play size={13} />}
                <span>{labels.testConnection}</span>
              </button>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => setEditModal(INITIAL_EDIT_STATE)}
                >
                  {labels.cancel}
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--primary"
                  onClick={handleSaveModal}
                >
                  {labels.saveServer}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 从 JSON 导入模态框 ───────────────────── */}
      {importModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "500px",
              background: "var(--dsw-alias-bg-base)",
              borderRadius: "12px",
              border: "1px solid var(--dsw-alias-border-l1)",
              padding: "22px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" }}>
                {labels.importModalTitle}
              </h3>
              <button
                type="button"
                className="settings-link-btn"
                onClick={() => setImportModalOpen(false)}
                style={{ padding: "4px" }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }}>
              {labels.importHintBefore} <code>claude_desktop_config.json</code>
              {labels.importHintMiddle}
              <code>mcpServers</code> {labels.importHintAfter}
            </p>

            <textarea
              rows={8}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder={`{\n  "mcpServers": {\n    "sqlite": {\n      "command": "uvx",\n      "args": ["mcp-server-sqlite", "--db-path", "test.db"]\n    }\n  }\n}`}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid var(--dsw-alias-border-l1)",
                background: "var(--dsw-alias-bg-layer-2)",
                color: "var(--dsw-alias-label-primary)",
                fontSize: "12px",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
              <button
                type="button"
                className="settings-btn"
                onClick={() => setImportModalOpen(false)}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={handleImportConfig}
                disabled={isImporting}
              >
                {isImporting ? <Loader2 size={13} className="spin-animate" /> : <Upload size={13} />}
                <span>{labels.confirmImport}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
