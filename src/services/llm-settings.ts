import type { YachiyoDatabase } from "../data/db";
import {
  type ActiveLlmConfig,
  type LlmSettingsRecord,
  type ProviderId,
  PROVIDER_METADATA,
  getProviderMeta,
  isProviderId,
  isValidApiKey,
  isValidBaseUrl,
} from "../domain/llm";

import { isDesktopApp } from "./app-platform";
import { apiFetch } from "./api-origins";

const ACTIVE_PROVIDER_KEY = "activeProvider" as const;

/**
 * LLM 厂商配置的本地读写服务。
 *
 * 设计：
 * - llmSettings 表按 provider 主键存储每家厂商的 apiKey/model（切换厂商时保留各自的 Key）。
 * - settings 表的 activeProvider 项指向当前激活的厂商。
 * - 未配置激活厂商或激活厂商的 Key 无效时，getActiveConfig 返回 undefined，
 *   调用方据此走服务端 fallback。
 */
export class LlmSettingsService {
  constructor(private readonly db: YachiyoDatabase) {}

  get(provider: ProviderId): Promise<LlmSettingsRecord | undefined> {
    return this.db.llmSettings.get(provider);
  }

  async put(record: LlmSettingsRecord): Promise<void> {
    await this.db.llmSettings.put(record);
  }

  async clear(provider: ProviderId): Promise<void> {
    if (isDesktopApp()) {
      void apiFetch(`/api/keys/${provider}`, { method: "DELETE" }).catch(() => undefined);
    }
    const active = await this.getActiveProvider();
    await this.db.transaction("rw", this.db.llmSettings, this.db.settings, async () => {
      await this.db.llmSettings.delete(provider);
      if (active === provider) {
        await this.db.settings.delete(ACTIVE_PROVIDER_KEY);
      }
    });
  }

  list(): Promise<LlmSettingsRecord[]> {
    return this.db.llmSettings.toArray();
  }

  async getActiveProvider(): Promise<ProviderId | undefined> {
    const record = await this.db.settings.get(ACTIVE_PROVIDER_KEY);
    const value = record?.value;
    return isProviderId(value) ? value : undefined;
  }

  async setActiveProvider(provider: ProviderId): Promise<void> {
    await this.db.settings.put({ key: ACTIVE_PROVIDER_KEY, value: provider });
  }

  async clearActiveProvider(): Promise<void> {
    await this.db.settings.delete(ACTIVE_PROVIDER_KEY);
  }

  /**
   * 返回当前激活厂商的完整配置；若未激活或 Key 无效则返回 undefined。
   */
  async getActiveConfig(): Promise<ActiveLlmConfig | undefined> {
    const provider = await this.getActiveProvider();
    if (provider === undefined) return undefined;
    const record = await this.db.llmSettings.get(provider);
    if (record === undefined) return undefined;
    if (!isValidApiKey(record.apiKey)) return undefined;
    return {
      provider: record.provider,
      apiKey: record.apiKey.trim(),
      model: record.model,
      ...(record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {}),
    };
  }

  /** 清除所有厂商配置与激活指针（供“清除本地数据”调用） */
  async clearAll(): Promise<void> {
    await this.db.transaction("rw", this.db.llmSettings, this.db.settings, async () => {
      await this.db.llmSettings.clear();
      await this.db.settings.delete(ACTIVE_PROVIDER_KEY);
    });
  }

  /**
   * 保存某厂商配置并（可选）将其设为激活。
   * 若当前没有任何激活厂商且未显式指定 activate，则自动激活以便用户立即生效。
   * 带 baseUrl（自定义 OpenAI 兼容端点）时跳过模型白名单，模型名交由上游校验。
   */
  async saveProvider(
    provider: ProviderId,
    apiKey: string,
    model: string,
    options: { activate?: boolean; baseUrl?: string } = {},
  ): Promise<LlmSettingsRecord> {
    const trimmedKey = apiKey.trim();
    if (isDesktopApp()) {
      void apiFetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key: trimmedKey }),
      }).catch(() => undefined);
    }
    const baseUrl = options.baseUrl?.trim() || undefined;
    if (baseUrl !== undefined && !isValidBaseUrl(baseUrl)) {
      throw new Error("Invalid base URL");
    }
    const meta = getProviderMeta(provider);
    const trimmedModel = model.trim();
    // 无自定义端点时按厂商白名单收敛，防止静默保存错误模型名
    const validModel =
      baseUrl !== undefined
        ? trimmedModel || meta.defaultModel
        : meta.models.includes(trimmedModel)
          ? trimmedModel
          : meta.defaultModel;
    const record: LlmSettingsRecord = {
      provider,
      apiKey: trimmedKey,
      model: validModel,
      updatedAt: Date.now(),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    await this.db.transaction("rw", this.db.llmSettings, this.db.settings, async () => {
      const currentActive = await this.db.settings.get(ACTIVE_PROVIDER_KEY);
      const hasActive =
        currentActive !== undefined && isProviderId(currentActive.value);
      await this.db.llmSettings.put(record);
      if (options.activate === true || (!hasActive && options.activate !== false)) {
        await this.db.settings.put({ key: ACTIVE_PROVIDER_KEY, value: provider });
      }
    });
    return record;
  }
}

/** 供 UI 在没有数据库实例时使用的静态模型列表查询 */
export function modelsFor(provider: ProviderId): readonly string[] {
  return PROVIDER_METADATA[provider].models;
}
