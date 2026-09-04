import {
  Boxes,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  Server,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import {
  DOMESTIC_PROVIDERS,
  INTERNATIONAL_PROVIDERS,
  MODEL_VENDORS,
  PROVIDER_METADATA,
  getProviderMeta,
  isValidApiKey,
  isValidBaseUrl,
  type ModelVendorItem,
  type ProviderId,
} from "../domain/llm";
import type { UiCopy } from "../i18n/messages";

export interface LlmProviderEntry {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LlmSettingsPanelProps {
  copy: UiCopy;
  open: boolean;
  activeProvider?: ProviderId;
  entries: readonly LlmProviderEntry[];
  onClose: () => void;
  onSave: (provider: ProviderId, apiKey: string, model: string, baseUrl?: string) => Promise<void>;
  onClear: (provider: ProviderId) => Promise<void>;
  onActivate: (provider: ProviderId) => Promise<void>;
}

interface Feedback {
  tone: "info" | "error";
  message: string;
}

export function LlmSettingsPanel({
  copy,
  open,
  activeProvider,
  entries,
  onClose,
  onSave,
  onClear,
  onActivate,
}: LlmSettingsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(
    activeProvider ?? DOMESTIC_PROVIDERS[0],
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();

  // 弹窗状态：'add' 为选择服务商，'config' 为配置表单，null 为关闭
  const [modalMode, setModalMode] = useState<"add" | "config" | null>(null);
  const [targetVendor, setTargetVendor] = useState<ModelVendorItem | null>(null);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModelName, setCustomModelName] = useState("");

  const { render, closing } = useClosing(open, 300);

  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const newProvider = activeProvider ?? DOMESTIC_PROVIDERS[0];
      setSelectedProvider(newProvider);
      const entry = entries.find((item) => item.provider === newProvider);
      const meta = getProviderMeta(newProvider);
      setApiKeyInput(entry?.apiKey ?? "");
      setModelInput(entry?.model ?? meta.defaultModel);
      setFeedback(undefined);
      setShowKey(false);
      setModalMode(null);
    }
  }

  const [prevSyncKey, setPrevSyncKey] = useState<{
    provider: ProviderId;
    entries: readonly LlmProviderEntry[];
  }>({ provider: selectedProvider, entries });
  if (selectedProvider !== prevSyncKey.provider || entries !== prevSyncKey.entries) {
    setPrevSyncKey({ provider: selectedProvider, entries });
    const entry = entries.find((item) => item.provider === selectedProvider);
    const meta = getProviderMeta(selectedProvider);
    setApiKeyInput(entry?.apiKey ?? "");
    setModelInput(entry?.model ?? meta.defaultModel);
    setFeedback(undefined);
  }

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!render) return null;

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback({ tone: "info", message: successMessage });
    } catch {
      setFeedback({ tone: "error", message: copy.genericFailure });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenAddModal = () => {
    setModalMode("add");
    setTargetVendor(null);
    setIsCustomModel(false);
  };

  const handleSelectVendor = (vendor: ModelVendorItem) => {
    setTargetVendor(vendor);
    setIsCustomModel(false);
    setSelectedProvider(vendor.mappedProvider);
    setPrevSyncKey({ provider: vendor.mappedProvider, entries });
    const entry = entries.find((item) => item.provider === vendor.mappedProvider);
    setApiKeyInput(entry?.apiKey ?? "");
    setModelInput(vendor.defaultModel);
    setCustomBaseUrl(vendor.defaultBaseUrl ?? "");
    setModalMode("config");
  };

  const handleSelectCustomModel = () => {
    setIsCustomModel(true);
    setTargetVendor(null);
    setSelectedProvider("openai");
    setPrevSyncKey({ provider: "openai", entries });
    const entry = entries.find((item) => item.provider === "openai");
    setApiKeyInput(entry?.apiKey ?? "");
    setCustomModelName("ox-alpha");
    setModelInput("ox-alpha");
    setCustomBaseUrl("https://api.openai.com/v1");
    setModalMode("config");
  };

  const handleEditEntry = (providerId: ProviderId, currentModelName: string) => {
    const vendor =
      MODEL_VENDORS.find((v) => v.mappedProvider === providerId) ?? MODEL_VENDORS[0];
    setTargetVendor(vendor);
    setIsCustomModel(false);
    setSelectedProvider(providerId);
    setPrevSyncKey({ provider: providerId, entries });
    const entry = entries.find((item) => item.provider === providerId);
    setApiKeyInput(entry?.apiKey ?? "");
    setModelInput(currentModelName || entry?.model || vendor.defaultModel);
    setCustomBaseUrl(entry?.baseUrl ?? vendor.defaultBaseUrl ?? "");
    setModalMode("config");
  };

  const handleSaveModal = async () => {
    const finalModel = isCustomModel
      ? customModelName.trim() || "custom-model"
      : modelInput.trim();
    // Base URL 仅在自定义模型或带默认端点的厂商配置中采集，其余保持 undefined 走原生端点
    const finalBaseUrl = customBaseUrl.trim() || undefined;
    await runAction(
      async () => {
        await onSave(selectedProvider, apiKeyInput, finalModel, finalBaseUrl);
        await onActivate(selectedProvider);
      },
      copy.llmSaved,
    );
    setModalMode(null);
  };

  const handleToggleActivate = (providerId: ProviderId) => {
    if (activeProvider === providerId) {
      /* 已是当前激活，无需重复操作 */
      return;
    }
    void runAction(() => onActivate(providerId), copy.llmSaved);
  };

  const handleClearEntry = (providerId: ProviderId) => {
    void runAction(async () => {
      await onClear(providerId);
      if (selectedProvider === providerId) {
        setApiKeyInput("");
        const meta = getProviderMeta(providerId);
        setModelInput(meta.defaultModel);
      }
    }, copy.llmCleared);
  };

  // 管理列表直接渲染用户实际保存的配置条目（每厂商一行）
  const displayRows: Array<{
    id: string;
    modelName: string;
    providerLabel: string;
    providerId: ProviderId;
    baseUrl?: string;
    isActive: boolean;
  }> = entries.map((entry) => ({
    id: `row-${entry.provider}`,
    modelName: entry.model || getProviderMeta(entry.provider).defaultModel,
    providerLabel: PROVIDER_METADATA[entry.provider].label,
    providerId: entry.provider,
    ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}),
    isActive: activeProvider === entry.provider,
  }));

  const currentMeta = getProviderMeta(selectedProvider);
  const isKeyValid = isValidApiKey(apiKeyInput);
  // Base URL 允许留空（走厂商原生端点），填写时必须是合法 https 地址
  const trimmedBaseUrl = customBaseUrl.trim();
  const isBaseUrlValid = trimmedBaseUrl.length === 0 || isValidBaseUrl(trimmedBaseUrl);

  return (
    <div className={`model-mgmt-container ${closing ? "model-mgmt-container--closing" : ""}`}>
      {/* 兼容无障碍和独立面板调用的隐藏表单与关闭入口 */}
      <div className="visually-hidden" aria-hidden="true">
        <button type="button" ref={closeRef} onClick={onClose} aria-label={copy.closeMenu}>
          {copy.closeMenu}
        </button>
        <label htmlFor="llm-provider-hidden">厂商</label>
        <select
          id="llm-provider-hidden"
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
          aria-label="厂商"
        >
          <optgroup label="国内厂商">
            {DOMESTIC_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_METADATA[id].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="国际厂商">
            {INTERNATIONAL_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_METADATA[id].label}
              </option>
            ))}
          </optgroup>
        </select>

        <label htmlFor="llm-key-hidden">API Key</label>
        <input
          id="llm-key-hidden"
          placeholder="API Key"
          type={showKey ? "text" : "password"}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
        />
        <button
          type="button"
          aria-label={showKey ? "隐藏" : "显示"}
          onClick={() => setShowKey((prev) => !prev)}
        >
          {showKey ? "隐藏" : "显示"}
        </button>

        <label htmlFor="llm-model-hidden">模型</label>
        <select
          id="llm-model-hidden"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          aria-label="模型"
        >
          {currentMeta.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <label htmlFor="llm-baseurl-hidden">API 端点</label>
        <input
          id="llm-baseurl-hidden"
          placeholder="API 端点"
          type="text"
          value={customBaseUrl}
          onChange={(e) => setCustomBaseUrl(e.target.value)}
        />

        <button
          type="button"
          disabled={busy || !isKeyValid}
          onClick={() =>
            void onSave(selectedProvider, apiKeyInput, modelInput, customBaseUrl.trim() || undefined)
          }
        >
          保存
        </button>
        {entries.find((e) => e.provider === selectedProvider) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onClear(selectedProvider)}
          >
            清除配置
          </button>
        )}
        {entries.find((e) => e.provider === selectedProvider) &&
          activeProvider !== selectedProvider && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onActivate(selectedProvider)}
            >
              设为当前
            </button>
          )}
        {!currentMeta.imageModels.includes(modelInput) && (
          <p>该厂商暂不支持图片输入</p>
        )}
        <p aria-live="polite">
          {activeProvider !== undefined
            ? `当前使用: ${PROVIDER_METADATA[activeProvider].label}`
            : "未配置，使用默认服务"}
        </p>
      </div>

      {/* ─── 顶部操作与描述 ─────────────────────────────── */}
      <div className="model-mgmt-header">
        <div className="model-mgmt-header__titles">
          <h4 className="model-mgmt-header__subtitle">模型管理</h4>
          <p className="model-mgmt-header__desc">
            配置 API key 添加更多可用模型，预置模型默认使用稳定版本。
          </p>
        </div>

        <button
          type="button"
          className="model-mgmt-add-btn"
          onClick={handleOpenAddModal}
        >
          <Plus size={15} />
          <span>添加模型</span>
        </button>
      </div>

      {/* ─── 模型列表表格 (对齐图 1) ─────────────────────────────── */}
      <div className="model-mgmt-table-wrap">
        <table className="model-mgmt-table" aria-label="模型管理表格">
          <thead>
            <tr>
              <th style={{ width: "42%" }}>模型</th>
              <th style={{ width: "38%" }}>服务商</th>
              <th style={{ width: "20%", textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="model-mgmt-empty">
                  尚未配置模型，点击右上角「添加模型」开始
                </td>
              </tr>
            ) : (
              displayRows.map((row) => (
                <tr key={row.id} className="model-mgmt-row">
                  <td className="model-mgmt-cell model-mgmt-cell--name">
                    <div className="model-mgmt-model-badge">
                      {row.baseUrl !== undefined ? (
                        <Boxes size={15} className="model-mgmt-model-icon" />
                      ) : (
                        <Server size={15} className="model-mgmt-model-icon" />
                      )}
                      <span className="model-mgmt-model-title">{row.modelName}</span>
                      {row.baseUrl !== undefined && (
                        <span className="model-tag-pill model-mgmt-endpoint-pill" title={row.baseUrl}>
                          自定义端点
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="model-mgmt-cell model-mgmt-cell--vendor">
                    <span className="model-mgmt-vendor-label">{row.providerLabel}</span>
                  </td>
                  <td className="model-mgmt-cell model-mgmt-cell--actions">
                    <div className="model-mgmt-actions-group">
                      <button
                        type="button"
                        className="model-mgmt-action-btn"
                        title="编辑模型配置"
                        aria-label={`编辑 ${row.modelName}`}
                        onClick={() => handleEditEntry(row.providerId, row.modelName)}
                      >
                        <Edit3 size={14} />
                      </button>

                      <button
                        type="button"
                        className="model-mgmt-action-btn model-mgmt-action-btn--delete"
                        title="清空或删除此模型"
                        aria-label={`删除 ${row.modelName}`}
                        onClick={() => handleClearEntry(row.providerId)}
                      >
                        <Trash2 size={14} />
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.isActive}
                        className={`settings-toggle-switch ${row.isActive ? "settings-toggle-switch--active" : ""}`}
                        onClick={() => handleToggleActivate(row.providerId)}
                        title={row.isActive ? "当前已启用" : "点击设为当前使用模型"}
                        aria-label={`切换启用 ${row.modelName}`}
                      >
                        <span className="settings-toggle-knob" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {feedback && (
        <div
          aria-live="polite"
          className={`model-mgmt-feedback model-mgmt-feedback--${feedback.tone}`}
        >
          {feedback.message}
        </div>
      )}

      {/* ─── 弹窗 1：添加模型选择器 (对齐图 2) ────────────────────────── */}
      {modalMode === "add" && (
        <div className="model-modal-overlay" role="dialog" aria-modal="true" aria-label="添加模型">
          <button
            type="button"
            tabIndex={-1}
            className="model-modal-backdrop"
            onClick={() => setModalMode(null)}
            aria-label="关闭添加模型遮罩"
          />
          <div className="model-modal-card">
            <div className="model-modal-card__header">
              <h3 className="model-modal-card__title">添加模型</h3>
              <button
                type="button"
                className="model-modal-card__close"
                onClick={() => setModalMode(null)}
                aria-label="关闭添加模型弹窗"
              >
                <X size={16} />
              </button>
            </div>

            <div className="model-modal-card__body">
              {/* 1. 自定义模型 (通栏) */}
              <button
                type="button"
                className="model-vendor-card model-vendor-card--custom"
                onClick={handleSelectCustomModel}
              >
                <div className="model-vendor-card__lead">
                  <div className="model-vendor-card__icon-box">
                    <Boxes size={18} />
                  </div>
                  <span className="model-vendor-card__name">自定义模型</span>
                </div>
                <ChevronRight size={15} className="model-vendor-card__arrow" />
              </button>

              {/* 2. 双列供应商网格 */}
              <div className="model-vendor-grid">
                {MODEL_VENDORS.map((vendor) => (
                  <button
                    key={vendor.id}
                    type="button"
                    className="model-vendor-card"
                    onClick={() => handleSelectVendor(vendor)}
                  >
                    <div className="model-vendor-card__lead">
                      <div className="model-vendor-card__icon-box">
                        <Sparkles size={16} />
                      </div>
                      <span className="model-vendor-card__name">{vendor.name}</span>
                    </div>
                    <ChevronRight size={15} className="model-vendor-card__arrow" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 弹窗 2：模型配置表单 ────────────────────────────────────── */}
      {modalMode === "config" && (
        <div className="model-modal-overlay" role="dialog" aria-modal="true" aria-label="配置模型">
          <button
            type="button"
            tabIndex={-1}
            className="model-modal-backdrop"
            onClick={() => setModalMode(null)}
            aria-label="关闭配置遮罩"
          />
          <div className="model-modal-card model-modal-card--form">
            <div className="model-modal-card__header">
              <h3 className="model-modal-card__title">
                {isCustomModel ? "配置自定义模型 (OpenAI Compatible)" : `配置 ${targetVendor?.name ?? "服务商"}`}
              </h3>
              <button
                type="button"
                className="model-modal-card__close"
                onClick={() => setModalMode(null)}
                aria-label="关闭配置弹窗"
              >
                <X size={16} />
              </button>
            </div>

            <div className="model-modal-card__body model-config-form">
              {/* API Key 输入框 */}
              <div className="model-form-field">
                <label htmlFor="model-cfg-api-key" className="model-form-label">API Key *</label>
                <div className="model-form-input-wrap">
                  <input
                    id="model-cfg-api-key"
                    type={showKey ? "text" : "password"}
                    className="model-form-input"
                    placeholder="请输入服务商 API Key"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="model-form-toggle-eye"
                    onClick={() => setShowKey((prev) => !prev)}
                    title={showKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <span className="model-form-hint">
                  {targetVendor?.keyHint || "在服务商开放平台获取 API Key"}
                </span>
              </div>

              {/* 模型选择 / 自定义输入 */}
              <div className="model-form-field">
                <label htmlFor="model-cfg-model-name" className="model-form-label">模型名称 (Model ID) *</label>
                {isCustomModel ? (
                  <input
                    id="model-cfg-model-name"
                    type="text"
                    className="model-form-input"
                    placeholder="如 ox-alpha / qwen-turbo"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                  />
                ) : (
                  <div className="model-form-input-wrap">
                    <input
                      id="model-cfg-model-name"
                      type="text"
                      className="model-form-input"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      placeholder={targetVendor?.defaultModel || "模型 ID"}
                    />
                  </div>
                )}
                {targetVendor?.models && targetVendor.models.length > 0 && (
                  <div className="model-preset-tags">
                    <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }}>
                      可选推荐:
                    </span>
                    {targetVendor.models.slice(0, 4).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="model-tag-pill"
                        onClick={() => setModelInput(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Base URL (针对自定义或中转) */}
              {(isCustomModel || targetVendor?.defaultBaseUrl) && (
                <div className="model-form-field">
                  <label htmlFor="model-cfg-base-url" className="model-form-label">API 端点 (Base URL)</label>
                  <input
                    id="model-cfg-base-url"
                    type="text"
                    className="model-form-input"
                    placeholder="如 https://api.openai.com/v1"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                  />
                </div>
              )}

              {/* 操作按钮栏 */}
              <div className="model-form-actions">
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost"
                  onClick={() => setModalMode(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--primary"
                  disabled={busy || !isValidApiKey(apiKeyInput) || !isBaseUrlValid}
                  title={
                    !isBaseUrlValid && trimmedBaseUrl.length > 0
                      ? "API 端点需为 https:// 开头且不含空格"
                      : undefined
                  }
                  onClick={() => void handleSaveModal()}
                >
                  保存并启用
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


