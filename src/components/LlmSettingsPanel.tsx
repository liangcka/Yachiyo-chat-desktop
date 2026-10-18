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
  KEYSTORE_MANAGED_API_KEY,
  MODEL_VENDORS,
  PROVIDER_METADATA,
  getProviderMeta,
  isValidApiKey,
  isValidBaseUrl,
  type ModelVendorItem,
  type ProviderId,
} from "../domain/llm";
import type { Locale } from "../domain/chat";
import { useLocale } from "../i18n/locale-context";
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

const zhCopy = {
  vendor: "厂商",
  domestic: "国内厂商",
  international: "国际厂商",
  hide: "隐藏",
  show: "显示",
  model: "模型",
  endpoint: "API 端点",
  save: "保存",
  clearConfig: "清除配置",
  setActive: "设为当前",
  noImage: "该厂商暂不支持图片输入",
  usingProvider: (label: string) => `当前使用: ${label}`,
  notConfigured: "未配置，使用默认服务",
  manageTitle: "模型管理",
  manageDesc: "配置 API key 添加更多可用模型，预置模型默认使用稳定版本。",
  addModel: "添加模型",
  tableLabel: "模型管理表格",
  provider: "服务商",
  actions: "操作",
  empty: "尚未配置模型，点击右上角「添加模型」开始",
  customEndpoint: "自定义端点",
  editTitle: "编辑模型配置",
  editLabel: (name: string) => `编辑 ${name}`,
  deleteTitle: "清空或删除此模型",
  deleteLabel: (name: string) => `删除 ${name}`,
  activeTitle: "当前已启用",
  activateTitle: "点击设为当前使用模型",
  toggleLabel: (name: string) => `切换启用 ${name}`,
  closeAddBackdrop: "关闭添加模型遮罩",
  closeAdd: "关闭添加模型弹窗",
  customModel: "自定义模型",
  configureModel: "配置模型",
  closeConfigBackdrop: "关闭配置遮罩",
  configureCustom: "配置自定义模型 (OpenAI Compatible)",
  configureVendor: (name: string) => `配置 ${name}`,
  vendorFallback: "服务商",
  closeConfig: "关闭配置弹窗",
  storedKeyPlaceholder: "已加密保存在本机，留空则保持不变",
  keyPlaceholder: "请输入服务商 API Key",
  hideKey: "隐藏 API Key",
  showKey: "显示 API Key",
  keySource: (source: string) => `在 ${source} 获取 API Key`,
  keySourceFallback: "在服务商开放平台获取 API Key",
  modelId: "模型名称 (Model ID) *",
  customModelPlaceholder: "如 ox-alpha / qwen-turbo",
  modelIdPlaceholder: "模型 ID",
  presets: "可选推荐:",
  baseUrl: "API 端点 (Base URL)",
  baseUrlPlaceholder: "如 https://api.openai.com/v1",
  cancel: "取消",
  baseUrlInvalid: "API 端点需为 https:// 开头且不含空格",
  saveAndEnable: "保存并启用",
};

type PanelCopy = typeof zhCopy;

const jaCopy: PanelCopy = {
  vendor: "プロバイダー",
  domestic: "中国のプロバイダー",
  international: "海外のプロバイダー",
  hide: "隠す",
  show: "表示",
  model: "モデル",
  endpoint: "API エンドポイント",
  save: "保存",
  clearConfig: "設定を削除",
  setActive: "使用中にする",
  noImage: "このプロバイダーは画像入力に対応していません",
  usingProvider: (label) => `使用中: ${label}`,
  notConfigured: "未設定のため既定のサービスを使用します",
  manageTitle: "モデル管理",
  manageDesc: "API キーを設定して利用できるモデルを追加します。プリセットのモデルは安定版を使用します。",
  addModel: "モデルを追加",
  tableLabel: "モデル管理テーブル",
  provider: "プロバイダー",
  actions: "操作",
  empty: "モデルはまだ設定されていません。右上の「モデルを追加」から始めましょう",
  customEndpoint: "カスタムエンドポイント",
  editTitle: "モデル設定を編集",
  editLabel: (name) => `${name} を編集`,
  deleteTitle: "このモデルを削除",
  deleteLabel: (name) => `${name} を削除`,
  activeTitle: "使用中",
  activateTitle: "クリックして使用中のモデルにする",
  toggleLabel: (name) => `${name} の使用を切り替え`,
  closeAddBackdrop: "モデル追加の背景を閉じる",
  closeAdd: "モデル追加ダイアログを閉じる",
  customModel: "カスタムモデル",
  configureModel: "モデルを設定",
  closeConfigBackdrop: "設定の背景を閉じる",
  configureCustom: "カスタムモデルを設定 (OpenAI 互換)",
  configureVendor: (name) => `${name} を設定`,
  vendorFallback: "プロバイダー",
  closeConfig: "設定ダイアログを閉じる",
  storedKeyPlaceholder: "この PC に暗号化して保存済み。空欄のままなら変更しません",
  keyPlaceholder: "プロバイダーの API キーを入力",
  hideKey: "API キーを隠す",
  showKey: "API キーを表示",
  keySource: (source) => `${source} で API キーを取得できます`,
  keySourceFallback: "プロバイダーの開発者コンソールで API キーを取得できます",
  modelId: "モデル名 (Model ID) *",
  customModelPlaceholder: "例: ox-alpha / qwen-turbo",
  modelIdPlaceholder: "モデル ID",
  presets: "おすすめ:",
  baseUrl: "API エンドポイント (Base URL)",
  baseUrlPlaceholder: "例: https://api.openai.com/v1",
  cancel: "キャンセル",
  baseUrlInvalid: "API エンドポイントは https:// で始まり、空白を含まない必要があります",
  saveAndEnable: "保存して有効化",
};

const PANEL_COPY: Readonly<Record<Locale, PanelCopy>> = { "zh-CN": zhCopy, "ja-JP": jaCopy };

/** 桌面端已存入系统加密存储的 Key 不回显到输入框，留空保存即沿用 */
function keyInputFor(entry: LlmProviderEntry | undefined): string {
  return entry?.apiKey === KEYSTORE_MANAGED_API_KEY ? "" : entry?.apiKey ?? "";
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
  const t = PANEL_COPY[useLocale()];
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
      setApiKeyInput(keyInputFor(entry));
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
    if (modalMode === null) {
      const entry = entries.find((item) => item.provider === selectedProvider);
      const meta = getProviderMeta(selectedProvider);
      setApiKeyInput(keyInputFor(entry));
      setModelInput(entry?.model ?? meta.defaultModel);
      setFeedback(undefined);
    }
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
    setApiKeyInput(keyInputFor(entry));
    setModelInput(entry?.model || vendor.defaultModel);
    setCustomBaseUrl(entry?.baseUrl ?? vendor.defaultBaseUrl ?? "");
    setModalMode("config");
  };

  const handleSelectCustomModel = () => {
    setIsCustomModel(true);
    setTargetVendor(null);
    setSelectedProvider("openai");
    setPrevSyncKey({ provider: "openai", entries });
    const entry = entries.find((item) => item.provider === "openai");
    setApiKeyInput(keyInputFor(entry));
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
    setApiKeyInput(keyInputFor(entry));
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
        await onSave(selectedProvider, keyToSave, finalModel, finalBaseUrl);
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
  const hasStoredKey =
    entries.find((entry) => entry.provider === selectedProvider)?.apiKey === KEYSTORE_MANAGED_API_KEY;
  const keyToSave = hasStoredKey && apiKeyInput.trim() === "" ? KEYSTORE_MANAGED_API_KEY : apiKeyInput;
  const isKeyValid = isValidApiKey(keyToSave);
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
        <label htmlFor="llm-provider-hidden">{t.vendor}</label>
        <select
          id="llm-provider-hidden"
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
          aria-label={t.vendor}
        >
          <optgroup label={t.domestic}>
            {DOMESTIC_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_METADATA[id].label}
              </option>
            ))}
          </optgroup>
          <optgroup label={t.international}>
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
          aria-label={showKey ? t.hide : t.show}
          onClick={() => setShowKey((prev) => !prev)}
        >
          {showKey ? t.hide : t.show}
        </button>

        <label htmlFor="llm-model-hidden">{t.model}</label>
        <select
          id="llm-model-hidden"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          aria-label={t.model}
        >
          {currentMeta.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <label htmlFor="llm-baseurl-hidden">{t.endpoint}</label>
        <input
          id="llm-baseurl-hidden"
          placeholder={t.endpoint}
          type="text"
          value={customBaseUrl}
          onChange={(e) => setCustomBaseUrl(e.target.value)}
        />

        <button
          type="button"
          disabled={busy || !isKeyValid}
          onClick={() =>
            void onSave(selectedProvider, keyToSave, modelInput, customBaseUrl.trim() || undefined)
          }
        >
          {t.save}
        </button>
        {entries.find((e) => e.provider === selectedProvider) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onClear(selectedProvider)}
          >
            {t.clearConfig}
          </button>
        )}
        {entries.find((e) => e.provider === selectedProvider) &&
          activeProvider !== selectedProvider && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onActivate(selectedProvider)}
            >
              {t.setActive}
            </button>
          )}
        {!currentMeta.imageModels.includes(modelInput) && (
          <p>{t.noImage}</p>
        )}
        <p aria-live="polite">
          {activeProvider !== undefined
            ? t.usingProvider(PROVIDER_METADATA[activeProvider].label)
            : t.notConfigured}
        </p>
      </div>

      {/* ─── 顶部操作与描述 ─────────────────────────────── */}
      <div className="model-mgmt-header">
        <div className="model-mgmt-header__titles">
          <h4 className="model-mgmt-header__subtitle">{t.manageTitle}</h4>
          <p className="model-mgmt-header__desc">{t.manageDesc}</p>
        </div>

        <button
          type="button"
          className="model-mgmt-add-btn"
          onClick={handleOpenAddModal}
        >
          <Plus size={15} />
          <span>{t.addModel}</span>
        </button>
      </div>

      {/* ─── 模型列表表格 (对齐图 1) ─────────────────────────────── */}
      <div className="model-mgmt-table-wrap">
        <table className="model-mgmt-table" aria-label={t.tableLabel}>
          <thead>
            <tr>
              <th style={{ width: "42%" }}>{t.model}</th>
              <th style={{ width: "38%" }}>{t.provider}</th>
              <th style={{ width: "20%", textAlign: "right" }}>{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="model-mgmt-empty">
                  {t.empty}
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
                          {t.customEndpoint}
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
                        title={t.editTitle}
                        aria-label={t.editLabel(row.modelName)}
                        onClick={() => handleEditEntry(row.providerId, row.modelName)}
                      >
                        <Edit3 size={14} />
                      </button>

                      <button
                        type="button"
                        className="model-mgmt-action-btn model-mgmt-action-btn--delete"
                        title={t.deleteTitle}
                        aria-label={t.deleteLabel(row.modelName)}
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
                        title={row.isActive ? t.activeTitle : t.activateTitle}
                        aria-label={t.toggleLabel(row.modelName)}
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
        <div className="model-modal-overlay" role="dialog" aria-modal="true" aria-label={t.addModel}>
          <button
            type="button"
            tabIndex={-1}
            className="model-modal-backdrop"
            onClick={() => setModalMode(null)}
            aria-label={t.closeAddBackdrop}
          />
          <div className="model-modal-card">
            <div className="model-modal-card__header">
              <h3 className="model-modal-card__title">{t.addModel}</h3>
              <button
                type="button"
                className="model-modal-card__close"
                onClick={() => setModalMode(null)}
                aria-label={t.closeAdd}
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
                  <span className="model-vendor-card__name">{t.customModel}</span>
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
        <div className="model-modal-overlay" role="dialog" aria-modal="true" aria-label={t.configureModel}>
          <button
            type="button"
            tabIndex={-1}
            className="model-modal-backdrop"
            onClick={() => setModalMode(null)}
            aria-label={t.closeConfigBackdrop}
          />
          <div className="model-modal-card model-modal-card--form">
            <div className="model-modal-card__header">
              <h3 className="model-modal-card__title">
                {isCustomModel ? t.configureCustom : t.configureVendor(targetVendor?.name ?? t.vendorFallback)}
              </h3>
              <button
                type="button"
                className="model-modal-card__close"
                onClick={() => setModalMode(null)}
                aria-label={t.closeConfig}
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
                    placeholder={hasStoredKey ? t.storedKeyPlaceholder : t.keyPlaceholder}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="model-form-toggle-eye"
                    onClick={() => setShowKey((prev) => !prev)}
                    title={showKey ? t.hideKey : t.showKey}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <span className="model-form-hint">
                  {targetVendor ? t.keySource(targetVendor.keySource) : t.keySourceFallback}
                </span>
              </div>

              {/* 模型选择 / 自定义输入 */}
              <div className="model-form-field">
                <label htmlFor="model-cfg-model-name" className="model-form-label">{t.modelId}</label>
                {isCustomModel ? (
                  <input
                    id="model-cfg-model-name"
                    type="text"
                    className="model-form-input"
                    placeholder={t.customModelPlaceholder}
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
                      placeholder={targetVendor?.defaultModel || t.modelIdPlaceholder}
                    />
                  </div>
                )}
                {targetVendor?.models && targetVendor.models.length > 0 && (
                  <div className="model-preset-tags">
                    <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }}>
                      {t.presets}
                    </span>
                    {targetVendor.models.slice(0, 8).map((m) => {
                      const isActive = (isCustomModel ? customModelName : modelInput) === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          className={`model-tag-pill ${isActive ? "model-tag-pill--active" : ""}`}
                          onClick={() => {
                            if (isCustomModel) setCustomModelName(m);
                            else setModelInput(m);
                          }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Base URL (针对自定义或中转) */}
              {(isCustomModel || targetVendor?.defaultBaseUrl) && (
                <div className="model-form-field">
                  <label htmlFor="model-cfg-base-url" className="model-form-label">{t.baseUrl}</label>
                  <input
                    id="model-cfg-base-url"
                    type="text"
                    className="model-form-input"
                    placeholder={t.baseUrlPlaceholder}
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
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--primary"
                  disabled={busy || !isKeyValid || !isBaseUrlValid}
                  title={
                    !isBaseUrlValid && trimmedBaseUrl.length > 0
                      ? t.baseUrlInvalid
                      : undefined
                  }
                  onClick={() => void handleSaveModal()}
                >
                  {t.saveAndEnable}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


