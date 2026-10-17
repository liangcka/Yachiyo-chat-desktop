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
import {
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

export const McpPanel: React.FC<McpPanelProps> = ({ showToast }) => {
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
      setServers(list);
    } catch (e) {
      notify(`加载 MCP 服务列表失败: ${String(e)}`, "error");
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
        setServers(list);
      } catch (e) {
        if (cancelled) return;
        notify(`加载 MCP 服务列表失败: ${String(e)}`, "error");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    const nextEnabled = !currentEnabled;
    const ok = await toggleMcpServer(id, nextEnabled);
    if (ok) {
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled: nextEnabled } : s)),
      );
      notify(nextEnabled ? `服务「${id}」已启用` : `服务「${id}」已禁用`, "info");
    } else {
      notify(`更新服务「${id}」状态失败`, "error");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确认删除 MCP 服务「${name || id}」吗？`)) {
      return;
    }
    const ok = await deleteMcpServer(id);
    if (ok) {
      setServers((prev) => prev.filter((s) => s.id !== id));
      notify(`服务「${name || id}」已删除`, "info");
    } else {
      notify(`删除服务「${id}」失败`, "error");
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
        notify(`连接成功！发现 ${res.tools.length} 个工具`, "info");
      } else {
        const errMsg = res.error || "连接测试失败";
        setServerTestErrorMap((prev) => ({ ...prev, [config.id]: errMsg }));
        notify(`连接失败: ${errMsg}`, "error");
      }
    } catch (e) {
      const errMsg = String(e);
      setServerTestErrorMap((prev) => ({ ...prev, [config.id]: errMsg }));
      notify(`连接出错: ${errMsg}`, "error");
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
      notify("服务 ID 不能为空", "error");
      return null;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
      notify("服务 ID 仅支持英文字母、数字、下划线与连字符", "error");
      return null;
    }

    const trimmedName = editModal.name.trim() || trimmedId;

    if (editModal.transportType === "stdio") {
      const trimmedCommand = editModal.command.trim();
      if (!trimmedCommand) {
        notify("请输入执行命令（例如 npx, uvx 等）", "error");
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
        notify("请输入远程 SSE / HTTP 服务端点 URL", "error");
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
        notify(`连接测试成功！发现 ${res.tools.length} 个工具`, "info");
      } else {
        notify(`连接测试失败: ${res.error ?? "未知错误"}`, "error");
      }
    } catch (e) {
      setModalTestResult({ success: false, error: String(e) });
      notify(`测试出错: ${String(e)}`, "error");
    } finally {
      setModalTesting(false);
    }
  };

  const handleSaveModal = async () => {
    const cfg = buildConfigFromModal();
    if (!cfg) return;

    const ok = await saveMcpServer(cfg);
    if (ok) {
      notify(`MCP 服务「${cfg.name}」已保存`, "info");
      setEditModal(INITIAL_EDIT_STATE);
      void reloadServers();
    } else {
      notify("保存 MCP 服务失败", "error");
    }
  };

  const handleExportConfig = async () => {
    const jsonStr = await exportClaudeMcpConfig();
    if (!jsonStr) {
      notify("导出配置失败", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(jsonStr);
      notify("已将 Claude Desktop 格式配置复制到剪贴板！", "info");
    } catch {
      notify("复制到剪贴板失败，请允许剪贴板访问权限", "error");
    }
  };

  const handleImportConfig = async () => {
    const text = importJsonText.trim();
    if (!text) {
      notify("请输入要导入的 JSON 内容", "error");
      return;
    }
    setIsImporting(true);
    try {
      const res = await importClaudeMcpConfig(text);
      if (res.success) {
        notify(`导入成功！共导入 ${res.count ?? 0} 个服务配置`, "info");
        setImportModalOpen(false);
        setImportJsonText("");
        void reloadServers();
      } else {
        notify(`导入失败: ${res.error ?? "格式不合法"}`, "error");
      }
    } catch (e) {
      notify(`导入失败: ${String(e)}`, "error");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="settings-panel-view settings-panel-view--mcp">
      {/* 顶部标题与说明 */}
      <div className="settings-panel-view__header">
        <h3 className="settings-panel-view__title">MCP 扩展服务 (Model Context Protocol)</h3>
        <p className="settings-panel-view__desc">
          基于开放 MCP 标准连接外部工具与数据源。八千代在多轮思考中可自主调用这些服务提供的专业能力。
        </p>
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
              <span>添加 MCP 服务</span>
            </button>

            <button
              type="button"
              className="settings-btn"
              onClick={() => setImportModalOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title="支持导入 Claude Desktop (claude_desktop_config.json) 格式配置"
            >
              <Upload size={14} />
              <span>从 JSON 导入</span>
            </button>

            <button
              type="button"
              className="settings-btn"
              onClick={handleExportConfig}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title="复制当前配置为 Claude Desktop 格式 JSON"
            >
              <Download size={14} />
              <span>导出配置</span>
            </button>

            <button
              type="button"
              className="settings-btn"
              onClick={reloadServers}
              disabled={loading}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              title="刷新配置列表"
            >
              <RefreshCw size={14} className={loading ? "spin-animate" : ""} />
              <span>刷新</span>
            </button>
          </div>

          <div style={{ fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }}>
            已配置 <strong>{servers.length}</strong> 个服务 · 已启用{" "}
            <strong style={{ color: "var(--accent-brand, #3b82f6)" }}>
              {servers.filter((s) => s.enabled).length}
            </strong>{" "}
            个
          </div>
        </div>
      </div>

      {/* 快捷模版预设区 */}
      <div className="settings-card-group" style={{ marginBottom: "16px" }}>
        <h4 className="settings-card-group__title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Sparkles size={14} style={{ color: "var(--accent-brand, #3b82f6)" }} />
          <span>常用 MCP 服务预设模版（一键填入）</span>
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
                  {preset.name}
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
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 服务列表 */}
      <div className="settings-card-group">
        <h4 className="settings-card-group__title">已配置的 MCP 服务器</h4>

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
            正在加载 MCP 服务列表...
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
              暂未配置任何 MCP 服务
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
              点击上方「常用 MCP 服务预设模版」快速体验 SQLite 查询或网页抓取，或从 Claude Desktop 配置中导入。
            </div>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={handleOpenAddModal}
            >
              <Plus size={14} />
              <span>添加首个 MCP 服务</span>
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
                        title="测试连接并获取工具列表"
                      >
                        {isTesting ? (
                          <Loader2 size={13} className="spin-animate" />
                        ) : (
                          <Play size={13} />
                        )}
                        <span style={{ fontSize: "11.5px" }}>测试连接</span>
                      </button>

                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => handleOpenEditModal(s)}
                        style={{ padding: "4px 8px", fontSize: "11.5px" }}
                      >
                        编辑
                      </button>

                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => handleDelete(s.id, s.name)}
                        style={{ padding: "4px 6px", color: "var(--dsw-alias-label-tertiary)" }}
                        title="删除服务"
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
                        aria-label={`切换服务 ${s.name} 状态`}
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
                        <span>已发现 <strong>{tools.length}</strong> 个工具能力</span>
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
                {editModal.isNew ? "添加 MCP 服务" : "编辑 MCP 服务"}
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
                传输协议类型
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className={`settings-btn ${editModal.transportType === "stdio" ? "settings-btn--primary" : ""}`}
                  onClick={() => setEditModal((prev) => ({ ...prev, transportType: "stdio" }))}
                  style={{ flex: 1, padding: "8px" }}
                >
                  <Terminal size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                  本地命令行进程 (stdio)
                </button>
                <button
                  type="button"
                  className={`settings-btn ${editModal.transportType === "sse" ? "settings-btn--primary" : ""}`}
                  onClick={() => setEditModal((prev) => ({ ...prev, transportType: "sse" }))}
                  style={{ flex: 1, padding: "8px" }}
                >
                  <Server size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                  远程端点 (SSE / HTTP)
                </button>
              </div>
            </div>

            {/* 服务唯一 ID */}
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "block", marginBottom: "4px" }}>
                服务 ID（必填，仅限字母数字下划线，作为工具命名空间）
              </div>
              <input
                type="text"
                value={editModal.id}
                disabled={!editModal.isNew}
                onChange={(e) => setEditModal((prev) => ({ ...prev, id: e.target.value }))}
                placeholder="例如: sqlite, fetch, my_server"
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
                显示名称
              </div>
              <input
                type="text"
                value={editModal.name}
                onChange={(e) => setEditModal((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如: 本地 SQLite 数据库"
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
                描述说明（可选）
              </div>
              <input
                type="text"
                value={editModal.description}
                onChange={(e) => setEditModal((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="简要描述该服务提供的能力..."
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
                    执行程序 / 命令 (Command)
                  </div>
                  <input
                    type="text"
                    value={editModal.command}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, command: e.target.value }))}
                    placeholder="例如: uvx, npx, python, node"
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
                    参数 (Arguments，空格分隔)
                  </div>
                  <input
                    type="text"
                    value={editModal.argsText}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, argsText: e.target.value }))}
                    placeholder="例如: mcp-server-sqlite --db-path ./test.db"
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
                    环境变量 (Environment，每行 KEY=VALUE)
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
                  服务 URL (Server Endpoint)
                </div>
                <input
                  type="text"
                  value={editModal.url}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, url: e.target.value }))}
                  placeholder="例如: http://127.0.0.1:8000/sse"
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
                    <span>测试通过！已成功发现 {modalTestResult.tools?.length ?? 0} 个工具。</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={14} />
                    <span>连接失败: {modalTestResult.error}</span>
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
                <span>测试连接</span>
              </button>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => setEditModal(INITIAL_EDIT_STATE)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--primary"
                  onClick={handleSaveModal}
                >
                  保存服务
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
                从 JSON 导入 MCP 配置
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
              可直接粘贴 Claude Desktop 的 <code>claude_desktop_config.json</code>（包含 <code>mcpServers</code> 字段）配置内容：
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
                取消
              </button>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={handleImportConfig}
                disabled={isImporting}
              >
                {isImporting ? <Loader2 size={13} className="spin-animate" /> : <Upload size={13} />}
                <span>确认导入</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
