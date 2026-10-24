import { ChevronDown, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Info, Link2, X } from "lucide-react";
import { useState } from "react";
import {
  API_FORMATS,
  API_FORMAT_PATHS,
  CUSTOM_MODEL_LIMITS,
  DEFAULT_MAX_TOOL_ROUNDS,
  KEYSTORE_MANAGED_API_KEY,
  MODEL_FAMILIES,
  isValidApiKey,
  isValidBaseUrl,
  type ApiFormat,
  type CustomModelSettings,
  type ModelFamily,
  type ThinkingMode,
} from "../../domain/llm";
import type { Locale } from "../../domain/chat";
import { useLocale } from "../../i18n/locale-context";
import { fetchModelList } from "../../services/model-list";
import type { LlmEntryDraft, LlmProviderEntry } from "../LlmSettingsPanel";

const zhCopy = {
  title: "自定义模型",
  editTitle: "编辑自定义模型",
  back: "返回服务商列表",
  close: "关闭自定义模型弹窗",
  apiFormat: "API 格式",
  formats: {
    chat_completions: "OpenAI Chat Completions 格式",
    responses: "OpenAI Responses API 格式",
    anthropic_messages: "Anthropic Messages 格式",
  } satisfies Record<ApiFormat, string>,
  baseUrl: "自定义请求地址",
  fullUrl: "完整 URL",
  baseUrlHint: (format: ApiFormat) =>
    `请填写兼容 ${format === "anthropic_messages" ? "Anthropic" : "OpenAI"} API 的服务端点地址，不要以斜杠结尾。${API_FORMAT_PATHS[format]} 将会被补充到你填写的地址末尾。`,
  fullUrlHint: "将按填写的完整地址发起请求，不再自动补充路径。",
  baseUrlPlaceholder: (format: ApiFormat): string =>
    format === "anthropic_messages" ? "例如 https://api.anthropic.com/v1" : "例如 https://api.openai.com/v1",
  modelId: "模型 ID",
  modelIdPlaceholder: "输入模型 ID",
  fetchModels: "获取模型列表",
  fetchingModels: "获取中…",
  fetchedModels: (count: number) => `端点提供 ${count} 个模型:`,
  fetchModelsEmpty: "端点未返回模型，请直接填写模型 ID",
  fetchModelsFailed: "获取模型列表失败，请检查请求地址与 Key，或直接填写模型 ID",
  displayName: "模型展示名称",
  displayNameHint: "在模型列表中展示的名称，未设置时默认显示 Model ID。",
  displayNamePlaceholder: "请输入模型展示名称",
  apiKey: "API 密钥",
  apiKeyPlaceholder: "请输入 API Key",
  storedKeyPlaceholder: "已加密保存在本机，留空则保持不变",
  endpointChangedNeedsKey: "已保存的 Key 只用于原来的地址，更改地址后请重新输入 API Key",
  hideKey: "隐藏 API Key",
  showKey: "显示 API Key",
  advanced: "高级配置",
  family: "模型系列",
  familyHint: "针对特定模型系列优化了 Prompt 和超参，未选择时使用默认配置。",
  familyDefault: "默认",
  families: {
    deepseek: "DeepSeek",
    qwen: "Qwen（通义千问）",
    glm: "GLM（智谱）",
    kimi: "Kimi",
    doubao: "Doubao（豆包 Seed）",
    minimax: "MiniMax",
    gpt: "GPT（OpenAI）",
    claude: "Claude（Anthropic）",
  } satisfies Record<ModelFamily, string>,
  contextWindow: "上下文窗口（Token）",
  input: "输入",
  output: "输出",
  tokenPlaceholder: "请输入数值，留空则使用最佳默认值",
  quickValue: (label: string) => `填入 ${label}`,
  toolRounds: "工具调用轮数",
  imageInput: "支持图片输入",
  imageInputTip: "选择「不支持」后聊天中不能发送图片，Agent 也不会使用截图工具。",
  supported: "支持",
  unsupported: "不支持",
  thinking: "思考模式",
  thinkingTip: "开启或关闭模型的思考过程；跟随模型默认配置时不发送任何思考参数。",
  thinkingDefault: "跟随模型默认配置",
  thinkingOn: "开启",
  thinkingOff: "关闭",
  sampling: "采样参数",
  samplingTip: "留空则不发送该参数，由服务端使用默认值。Top K 仅部分服务支持，Responses 格式不会发送。",
  temperaturePlaceholder: "留空使用最佳配置，或输入 0 ~ 2 之间的数值",
  topPPlaceholder: "留空使用最佳配置，或输入 0 ~ 1 之间的数值",
  topKPlaceholder: "留空使用最佳配置，或输入 1 ~ 100 之间的数值",
  footerHint: "连通性测试会发起一次真实请求，会消耗少量模型Token",
  reset: "重置",
  add: "添加模型",
  save: "保存",
  testing: "测试连通性…",
  required: "此项为必填项",
  baseUrlInvalid: "请求地址需为 https:// 开头且不含空格",
  baseUrlTrailingSlash: "请求地址不要以斜杠结尾",
  apiKeyInvalid: "API Key 需为 20～512 位可打印字符",
  rangeInvalid: (min: string, max: string) => `请输入 ${min} ~ ${max} 之间的数值`,
  integerInvalid: (min: string, max: string) => `请输入 ${min} ~ ${max} 之间的整数`,
  testFailed: (detail: string) => `连通性测试失败：${detail}`,
};

type FormCopy = typeof zhCopy;

const jaCopy: FormCopy = {
  title: "カスタムモデル",
  editTitle: "カスタムモデルを編集",
  back: "プロバイダー一覧に戻る",
  close: "カスタムモデルダイアログを閉じる",
  apiFormat: "API 形式",
  formats: {
    chat_completions: "OpenAI Chat Completions 形式",
    responses: "OpenAI Responses API 形式",
    anthropic_messages: "Anthropic Messages 形式",
  },
  baseUrl: "カスタムリクエスト URL",
  fullUrl: "完全な URL",
  baseUrlHint: (format) =>
    `${format === "anthropic_messages" ? "Anthropic" : "OpenAI"} API 互換のエンドポイントを入力してください（末尾にスラッシュを付けないでください）。入力したアドレスの末尾に ${API_FORMAT_PATHS[format]} が補完されます。`,
  fullUrlHint: "入力したアドレスをそのまま使用し、パスを補完しません。",
  baseUrlPlaceholder: (format) =>
    format === "anthropic_messages" ? "例: https://api.anthropic.com/v1" : "例: https://api.openai.com/v1",
  modelId: "モデル ID",
  modelIdPlaceholder: "モデル ID を入力",
  fetchModels: "モデル一覧を取得",
  fetchingModels: "取得中…",
  fetchedModels: (count) => `エンドポイントのモデル（${count} 件）:`,
  fetchModelsEmpty: "エンドポイントからモデルが返されませんでした。モデル ID を直接入力してください",
  fetchModelsFailed: "モデル一覧を取得できませんでした。URL とキーを確認するか、モデル ID を直接入力してください",
  displayName: "モデル表示名",
  displayNameHint: "モデル一覧に表示される名前です。未設定の場合は Model ID を表示します。",
  displayNamePlaceholder: "モデル表示名を入力",
  apiKey: "API キー",
  apiKeyPlaceholder: "API キーを入力",
  storedKeyPlaceholder: "この PC に暗号化して保存済み。空欄のままなら変更しません",
  endpointChangedNeedsKey: "保存済みのキーは元の URL 専用です。URL を変更した場合は API キーを再入力してください",
  hideKey: "API キーを隠す",
  showKey: "API キーを表示",
  advanced: "詳細設定",
  family: "モデルシリーズ",
  familyHint: "特定のモデルシリーズ向けにプロンプトとパラメーターを最適化します。未選択の場合は既定の設定を使用します。",
  familyDefault: "既定",
  families: {
    deepseek: "DeepSeek",
    qwen: "Qwen（通義千問）",
    glm: "GLM（智譜）",
    kimi: "Kimi",
    doubao: "Doubao（豆包 Seed）",
    minimax: "MiniMax",
    gpt: "GPT（OpenAI）",
    claude: "Claude（Anthropic）",
  },
  contextWindow: "コンテキストウィンドウ（Token）",
  input: "入力",
  output: "出力",
  tokenPlaceholder: "数値を入力。空欄なら最適な既定値を使用",
  quickValue: (label) => `${label} を入力`,
  toolRounds: "ツール呼び出しの回数",
  imageInput: "画像入力に対応",
  imageInputTip: "「非対応」にするとチャットで画像を送信できず、Agent もスクリーンショットツールを使用しません。",
  supported: "対応",
  unsupported: "非対応",
  thinking: "思考モード",
  thinkingTip: "モデルの思考プロセスをオン／オフします。モデルの既定に従う場合は思考パラメーターを送信しません。",
  thinkingDefault: "モデルの既定に従う",
  thinkingOn: "オン",
  thinkingOff: "オフ",
  sampling: "サンプリングパラメーター",
  samplingTip: "空欄の場合はパラメーターを送信せず、サーバーの既定値を使用します。Top K は一部のサービスのみ対応で、Responses 形式では送信しません。",
  temperaturePlaceholder: "空欄で最適な設定、または 0 ~ 2 の数値",
  topPPlaceholder: "空欄で最適な設定、または 0 ~ 1 の数値",
  topKPlaceholder: "空欄で最適な設定、または 1 ~ 100 の数値",
  footerHint: "接続テストは実際のリクエストを 1 回送信し、少量のトークンを消費します",
  reset: "リセット",
  add: "モデルを追加",
  save: "保存",
  testing: "接続をテスト中…",
  required: "必須項目です",
  baseUrlInvalid: "URL は https:// で始まり、空白を含まない必要があります",
  baseUrlTrailingSlash: "URL の末尾にスラッシュを付けないでください",
  apiKeyInvalid: "API キーは 20～512 文字の印字可能な文字で入力してください",
  rangeInvalid: (min, max) => `${min} ~ ${max} の数値を入力してください`,
  integerInvalid: (min, max) => `${min} ~ ${max} の整数を入力してください`,
  testFailed: (detail) => `接続テストに失敗しました: ${detail}`,
};

const FORM_COPY: Readonly<Record<Locale, FormCopy>> = { "zh-CN": zhCopy, "ja-JP": jaCopy };

const INPUT_PRESETS = [
  { label: "128k", value: 131_072 },
  { label: "256k", value: 262_144 },
  { label: "512k", value: 524_288 },
  { label: "1M", value: 1_048_576 },
] as const;

const OUTPUT_PRESETS = [
  { label: "4k", value: 4_096 },
  { label: "16k", value: 16_384 },
  { label: "32k", value: 32_768 },
  { label: "128k", value: 131_072 },
] as const;

interface FormState {
  apiFormat: ApiFormat;
  baseUrl: string;
  fullUrl: boolean;
  model: string;
  displayName: string;
  apiKey: string;
  family: ModelFamily | "";
  contextWindow: string;
  maxOutputTokens: string;
  maxToolRounds: string;
  supportsImage: boolean;
  thinking: ThinkingMode | "default";
  temperature: string;
  topP: string;
  topK: string;
}

/** 编辑时从已保存配置回填；桌面端已存入加密存储的 Key 不回显 */
function initialState(entry: LlmProviderEntry | undefined): FormState {
  const custom = entry?.custom;
  const text = (value: number | undefined) => (value === undefined ? "" : String(value));
  return {
    apiFormat: custom?.apiFormat ?? "chat_completions",
    baseUrl: entry?.baseUrl ?? "",
    fullUrl: custom?.fullUrl === true,
    model: entry?.model ?? "",
    displayName: custom?.displayName ?? "",
    apiKey: entry === undefined || entry.apiKey === KEYSTORE_MANAGED_API_KEY ? "" : entry.apiKey,
    family: custom?.family ?? "",
    contextWindow: text(custom?.contextWindow),
    maxOutputTokens: text(custom?.maxOutputTokens),
    maxToolRounds: String(custom?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS),
    supportsImage: custom?.supportsImage !== false,
    thinking: custom?.thinking ?? "default",
    temperature: text(custom?.temperature),
    topP: text(custom?.topP),
    topK: text(custom?.topK),
  };
}

type NumberField = "contextWindow" | "maxOutputTokens" | "maxToolRounds" | "temperature" | "topP" | "topK";

const NUMBER_RULES: Readonly<Record<NumberField, { min: number; max: number; integer: boolean }>> = {
  contextWindow: { ...CUSTOM_MODEL_LIMITS.contextWindow, integer: true },
  maxOutputTokens: { ...CUSTOM_MODEL_LIMITS.maxOutputTokens, integer: true },
  maxToolRounds: { ...CUSTOM_MODEL_LIMITS.maxToolRounds, integer: true },
  temperature: { ...CUSTOM_MODEL_LIMITS.temperature, integer: false },
  topP: { ...CUSTOM_MODEL_LIMITS.topP, integer: false },
  topK: { ...CUSTOM_MODEL_LIMITS.topK, integer: true },
};

/** 空串视为未填写；非空时必须是范围内的数字（整数字段不接受小数） */
function parseNumber(text: string, field: NumberField): { value?: number; invalid: boolean } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { invalid: false };
  const rule = NUMBER_RULES[field];
  const value = Number(trimmed);
  const valid =
    /^-?\d+(\.\d+)?$/u.test(trimmed) &&
    (!rule.integer || Number.isInteger(value)) &&
    value >= rule.min &&
    value <= rule.max;
  return valid ? { value, invalid: false } : { invalid: true };
}

function displayNameLength(value: string): number {
  return [...value.trim()].length;
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="model-form-tip" role="img" aria-label={text} title={text}>
      <Info size={13} aria-hidden="true" />
    </span>
  );
}

export interface CustomModelFormProps {
  /** 正在编辑的配置；undefined 表示新建 */
  entry?: LlmProviderEntry;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  onSubmit: (draft: LlmEntryDraft) => Promise<void>;
  /** 保存前的连通性测试；失败时抛出带说明的错误，不保存 */
  onTestConnection?: (draft: LlmEntryDraft) => Promise<void>;
}

export function CustomModelForm({ entry, busy, onBack, onClose, onSubmit, onTestConnection }: CustomModelFormProps) {
  const t = FORM_COPY[useLocale()];
  const [form, setForm] = useState<FormState>(() => initialState(entry));
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string>();
  const [fetchedModels, setFetchedModels] = useState<readonly string[]>();
  const [modelsStatus, setModelsStatus] = useState<"idle" | "loading" | "error">("idle");

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestError(undefined);
  };

  const baseUrl = form.baseUrl.trim();
  // 桌面网关把已存 Key 绑定在保存时的地址上，地址改了就不能再沿用
  const hasStoredKey = entry?.apiKey === KEYSTORE_MANAGED_API_KEY;
  const endpointChanged = hasStoredKey && baseUrl !== entry?.baseUrl;
  const canReuseStoredKey = hasStoredKey && !endpointChanged;
  const keyToSave = canReuseStoredKey && form.apiKey.trim() === "" ? KEYSTORE_MANAGED_API_KEY : form.apiKey;

  const numbers = {
    contextWindow: parseNumber(form.contextWindow, "contextWindow"),
    maxOutputTokens: parseNumber(form.maxOutputTokens, "maxOutputTokens"),
    maxToolRounds: parseNumber(form.maxToolRounds, "maxToolRounds"),
    temperature: parseNumber(form.temperature, "temperature"),
    topP: parseNumber(form.topP, "topP"),
    topK: parseNumber(form.topK, "topK"),
  };

  // 必填项在首次提交后才提示缺失；已填写的非法值即时提示
  const errors = {
    baseUrl:
      baseUrl.length === 0
        ? submitted ? t.required : undefined
        : !isValidBaseUrl(baseUrl)
          ? t.baseUrlInvalid
          : !form.fullUrl && baseUrl.endsWith("/")
            ? t.baseUrlTrailingSlash
            : undefined,
    model: submitted && form.model.trim().length === 0 ? t.required : undefined,
    apiKey:
      keyToSave.trim().length === 0
        ? submitted ? t.required : undefined
        : !isValidApiKey(keyToSave)
          ? t.apiKeyInvalid
          : undefined,
  };
  const numberError = (field: NumberField) => {
    if (!numbers[field].invalid) return undefined;
    const rule = NUMBER_RULES[field];
    return (rule.integer ? t.integerInvalid : t.rangeInvalid)(String(rule.min), String(rule.max));
  };
  const hasErrors =
    baseUrl.length === 0 ||
    form.model.trim().length === 0 ||
    keyToSave.trim().length === 0 ||
    Object.values(errors).some((error) => error !== undefined) ||
    Object.values(numbers).some((parsed) => parsed.invalid);

  const buildDraft = (): LlmEntryDraft => {
    const displayName = form.displayName.trim();
    const custom: CustomModelSettings = {
      apiFormat: form.apiFormat,
      ...(form.fullUrl ? { fullUrl: true } : {}),
      ...(displayName.length > 0 ? { displayName } : {}),
      ...(form.family !== "" ? { family: form.family } : {}),
      ...(numbers.contextWindow.value !== undefined ? { contextWindow: numbers.contextWindow.value } : {}),
      ...(numbers.maxOutputTokens.value !== undefined ? { maxOutputTokens: numbers.maxOutputTokens.value } : {}),
      maxToolRounds: numbers.maxToolRounds.value ?? DEFAULT_MAX_TOOL_ROUNDS,
      ...(form.supportsImage ? {} : { supportsImage: false }),
      ...(form.thinking !== "default" ? { thinking: form.thinking } : {}),
      ...(numbers.temperature.value !== undefined ? { temperature: numbers.temperature.value } : {}),
      ...(numbers.topP.value !== undefined ? { topP: numbers.topP.value } : {}),
      ...(numbers.topK.value !== undefined ? { topK: numbers.topK.value } : {}),
    };
    return {
      ...(entry !== undefined ? { id: entry.id } : {}),
      provider: entry?.provider ?? "openai",
      apiKey: keyToSave,
      model: form.model.trim(),
      baseUrl,
      custom,
    };
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    if (hasErrors) {
      // 高级配置里的非法值在折叠时看不到，展开提示
      if (Object.values(numbers).some((parsed) => parsed.invalid)) setAdvancedOpen(true);
      return;
    }
    const draft = buildDraft();
    if (onTestConnection !== undefined) {
      setTesting(true);
      setTestError(undefined);
      try {
        await onTestConnection(draft);
      } catch (error) {
        setTestError(t.testFailed(error instanceof Error && error.message.length > 0 ? error.message : "-"));
        return;
      } finally {
        setTesting(false);
      }
    }
    await onSubmit(draft);
  };

  const handleReset = () => {
    setForm(initialState(entry));
    setSubmitted(false);
    setTestError(undefined);
    setFetchedModels(undefined);
    setModelsStatus("idle");
  };

  const handleFetchModels = async () => {
    setModelsStatus("loading");
    try {
      const models = await fetchModelList({
        baseUrl,
        ...(keyToSave !== KEYSTORE_MANAGED_API_KEY ? { apiKey: keyToSave } : {}),
        ...(entry !== undefined ? { slot: entry.id } : {}),
      });
      setFetchedModels(models);
      setModelsStatus("idle");
    } catch {
      setFetchedModels(undefined);
      setModelsStatus("error");
    }
  };

  const fieldError = (message: string | undefined) =>
    message === undefined ? null : <span className="model-form-error" role="alert">{message}</span>;

  const tokenRow = (
    field: "contextWindow" | "maxOutputTokens",
    label: string,
    presets: ReadonlyArray<{ label: string; value: number }>,
  ) => (
    <div className="model-form-token-row">
      <div className="model-form-affix">
        <label htmlFor={`custom-model-${field}`} className="model-form-affix__label">{label}</label>
        <input
          id={`custom-model-${field}`}
          type="text"
          inputMode="numeric"
          className="model-form-affix__input"
          placeholder={t.tokenPlaceholder}
          value={form[field]}
          onChange={(e) => update(field, e.target.value)}
        />
      </div>
      <div className="model-form-quick-values">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="model-form-quick-value"
            aria-label={`${label} ${t.quickValue(preset.label)}`}
            onClick={() => update(field, String(preset.value))}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );

  const samplingRow = (field: "temperature" | "topP" | "topK", label: string, placeholder: string) => (
    <div className="model-form-affix">
      <label htmlFor={`custom-model-${field}`} className="model-form-affix__label model-form-affix__label--wide">{label}</label>
      <input
        id={`custom-model-${field}`}
        type="text"
        inputMode="decimal"
        className="model-form-affix__input"
        placeholder={placeholder}
        value={form[field]}
        onChange={(e) => update(field, e.target.value)}
      />
    </div>
  );

  const working = busy || testing;

  return (
    <div className="model-modal-card model-modal-card--form model-modal-card--custom">
      <div className="model-modal-card__header">
        <div className="model-modal-card__title-group">
          {entry === undefined && (
            <button type="button" className="model-modal-card__close" onClick={onBack} aria-label={t.back}>
              <ChevronLeft size={16} />
            </button>
          )}
          <h3 className="model-modal-card__title">{entry === undefined ? t.title : t.editTitle}</h3>
        </div>
        <button type="button" className="model-modal-card__close" onClick={onClose} aria-label={t.close}>
          <X size={16} />
        </button>
      </div>

      <div className="model-modal-card__body model-config-form">
        <div className="model-form-field">
          <label htmlFor="custom-model-format" className="model-form-label model-form-label--required">{t.apiFormat}</label>
          <select
            id="custom-model-format"
            className="model-form-input model-form-select"
            value={form.apiFormat}
            onChange={(e) => update("apiFormat", e.target.value as ApiFormat)}
          >
            {API_FORMATS.map((format) => (
              <option key={format} value={format}>{t.formats[format]}</option>
            ))}
          </select>
        </div>

        <div className="model-form-field">
          <div className="model-form-label-row">
            <label htmlFor="custom-model-base-url" className="model-form-label model-form-label--required">{t.baseUrl}</label>
            <span className="model-form-inline-switch">
              <Link2 size={13} aria-hidden="true" />
              <span>{t.fullUrl}</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.fullUrl}
                aria-label={t.fullUrl}
                className={`settings-toggle-switch ${form.fullUrl ? "settings-toggle-switch--active" : ""}`}
                onClick={() => update("fullUrl", !form.fullUrl)}
              >
                <span className="settings-toggle-knob" />
              </button>
            </span>
          </div>
          <span className="model-form-hint">{form.fullUrl ? t.fullUrlHint : t.baseUrlHint(form.apiFormat)}</span>
          <input
            id="custom-model-base-url"
            type="text"
            className="model-form-input"
            placeholder={t.baseUrlPlaceholder(form.apiFormat)}
            value={form.baseUrl}
            aria-invalid={errors.baseUrl !== undefined}
            onChange={(e) => update("baseUrl", e.target.value)}
          />
          {fieldError(errors.baseUrl)}
        </div>

        <div className="model-form-field">
          <label htmlFor="custom-model-id" className="model-form-label model-form-label--required">{t.modelId}</label>
          <div className="model-form-input-row">
            <input
              id="custom-model-id"
              type="text"
              className="model-form-input"
              placeholder={t.modelIdPlaceholder}
              value={form.model}
              aria-invalid={errors.model !== undefined}
              onChange={(e) => update("model", e.target.value)}
            />
            {!form.fullUrl && (
              <button
                type="button"
                className="settings-btn settings-btn--ghost model-form-fetch-btn"
                disabled={
                  modelsStatus === "loading" ||
                  baseUrl.length === 0 ||
                  errors.baseUrl !== undefined ||
                  !isValidApiKey(keyToSave)
                }
                onClick={() => void handleFetchModels()}
              >
                <Download size={14} />
                <span>{modelsStatus === "loading" ? t.fetchingModels : t.fetchModels}</span>
              </button>
            )}
          </div>
          {fieldError(errors.model)}
          {modelsStatus === "error" && <span className="model-form-error" role="alert">{t.fetchModelsFailed}</span>}
          {fetchedModels !== undefined && fetchedModels.length === 0 && (
            <span className="model-form-hint">{t.fetchModelsEmpty}</span>
          )}
          {fetchedModels !== undefined && fetchedModels.length > 0 && (
            <div className="model-preset-tags model-preset-tags--scroll">
              <span className="model-form-hint">{t.fetchedModels(fetchedModels.length)}</span>
              {fetchedModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  className={`model-tag-pill ${form.model === model ? "model-tag-pill--active" : ""}`}
                  onClick={() => update("model", model)}
                >
                  {model}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="model-form-field">
          <label htmlFor="custom-model-display-name" className="model-form-label">{t.displayName}</label>
          <span className="model-form-hint">{t.displayNameHint}</span>
          <div className="model-form-input-wrap">
            <input
              id="custom-model-display-name"
              type="text"
              className="model-form-input model-form-input--counter"
              placeholder={t.displayNamePlaceholder}
              maxLength={CUSTOM_MODEL_LIMITS.displayName}
              value={form.displayName}
              onChange={(e) => update("displayName", e.target.value)}
            />
            <span className="model-form-counter" aria-hidden="true">
              {displayNameLength(form.displayName)}/{CUSTOM_MODEL_LIMITS.displayName}
            </span>
          </div>
        </div>

        <div className="model-form-field">
          <label htmlFor="custom-model-api-key" className="model-form-label model-form-label--required">{t.apiKey}</label>
          <div className="model-form-input-wrap">
            <input
              id="custom-model-api-key"
              type={showKey ? "text" : "password"}
              className="model-form-input"
              placeholder={canReuseStoredKey ? t.storedKeyPlaceholder : t.apiKeyPlaceholder}
              value={form.apiKey}
              aria-invalid={errors.apiKey !== undefined}
              onChange={(e) => update("apiKey", e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="model-form-toggle-eye"
              onClick={() => setShowKey((prev) => !prev)}
              aria-label={showKey ? t.hideKey : t.showKey}
              title={showKey ? t.hideKey : t.showKey}
            >
              {showKey ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>
          {endpointChanged && form.apiKey.trim() === "" && <span className="model-form-hint">{t.endpointChangedNeedsKey}</span>}
          {fieldError(errors.apiKey)}
        </div>

        <div className="model-form-advanced">
          <button
            type="button"
            className="model-form-advanced__toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            <span>{t.advanced}</span>
            {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {advancedOpen && (
            <div className="model-config-form">
              <div className="model-form-field">
                <label htmlFor="custom-model-family" className="model-form-label">{t.family}</label>
                <span className="model-form-hint">{t.familyHint}</span>
                <select
                  id="custom-model-family"
                  className="model-form-input model-form-select"
                  value={form.family}
                  onChange={(e) => update("family", e.target.value as ModelFamily | "")}
                >
                  <option value="">{t.familyDefault}</option>
                  {MODEL_FAMILIES.map((family) => (
                    <option key={family} value={family}>{t.families[family]}</option>
                  ))}
                </select>
              </div>

              <div className="model-form-field">
                <span className="model-form-label">{t.contextWindow}</span>
                {tokenRow("contextWindow", t.input, INPUT_PRESETS)}
                {fieldError(numberError("contextWindow"))}
                {tokenRow("maxOutputTokens", t.output, OUTPUT_PRESETS)}
                {fieldError(numberError("maxOutputTokens"))}
              </div>

              <div className="model-form-field">
                <label htmlFor="custom-model-tool-rounds" className="model-form-label">{t.toolRounds}</label>
                <input
                  id="custom-model-tool-rounds"
                  type="text"
                  inputMode="numeric"
                  className="model-form-input"
                  placeholder={String(DEFAULT_MAX_TOOL_ROUNDS)}
                  value={form.maxToolRounds}
                  onChange={(e) => update("maxToolRounds", e.target.value)}
                />
                {fieldError(numberError("maxToolRounds"))}
              </div>

              <fieldset className="model-form-field model-form-fieldset">
                <legend className="model-form-label">
                  {t.imageInput}
                  <InfoTip text={t.imageInputTip} />
                </legend>
                <div className="model-form-radio-group">
                  <label className="model-form-radio">
                    <input
                      type="radio"
                      name="custom-model-image"
                      checked={form.supportsImage}
                      onChange={() => update("supportsImage", true)}
                    />
                    {t.supported}
                  </label>
                  <label className="model-form-radio">
                    <input
                      type="radio"
                      name="custom-model-image"
                      checked={!form.supportsImage}
                      onChange={() => update("supportsImage", false)}
                    />
                    {t.unsupported}
                  </label>
                </div>
              </fieldset>

              <fieldset className="model-form-field model-form-fieldset">
                <legend className="model-form-label">
                  {t.thinking}
                  <InfoTip text={t.thinkingTip} />
                </legend>
                <div className="model-form-radio-group">
                  {(
                    [
                      ["default", t.thinkingDefault],
                      ["on", t.thinkingOn],
                      ["off", t.thinkingOff],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="model-form-radio">
                      <input
                        type="radio"
                        name="custom-model-thinking"
                        checked={form.thinking === value}
                        onChange={() => update("thinking", value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="model-form-field">
                <span className="model-form-label">
                  {t.sampling}
                  <InfoTip text={t.samplingTip} />
                </span>
                {samplingRow("temperature", "Temperature", t.temperaturePlaceholder)}
                {fieldError(numberError("temperature"))}
                {samplingRow("topP", "Top P", t.topPPlaceholder)}
                {fieldError(numberError("topP"))}
                {samplingRow("topK", "Top K", t.topKPlaceholder)}
                {fieldError(numberError("topK"))}
              </div>
            </div>
          )}
        </div>

        {testError !== undefined && <span className="model-form-error" role="alert">{testError}</span>}

        <div className="model-form-footer">
          <span className="model-form-footer__hint">
            <Info size={13} aria-hidden="true" />
            {t.footerHint}
          </span>
          <div className="model-form-footer__actions">
            <button type="button" className="settings-btn settings-btn--ghost" disabled={working} onClick={handleReset}>
              {t.reset}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              disabled={working}
              onClick={() => void handleSubmit()}
            >
              {testing ? t.testing : entry === undefined ? t.add : t.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
