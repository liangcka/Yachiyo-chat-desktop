import type { YachiyoDatabase } from "../data/db";
import {
  type ActiveLlmConfig,
  type CustomModelSettings,
  type LlmSettingsRecord,
  type ProviderId,
  KEYSTORE_MANAGED_API_KEY,
  PROVIDER_METADATA,
  getProviderMeta,
  newLlmEntryId,
  isValidApiKey,
  isValidBaseUrl,
  normalizeCustomModelSettings,
} from "../domain/llm";

import { isDesktopApp } from "./app-platform";
import { apiFetch } from "./api-origins";

const ACTIVE_ENTRY_KEY = "activeProvider" as const;

/**
 * LLM 模型配置的本地读写服务。
 *
 * 设计：
 * - llmEntries 表按配置 id 存储每条模型配置（厂商、模型、端点、Key），同一厂商可有多条，互不覆盖。
 * - 桌面端 Key 存在网关的系统加密存储里，槽名即配置 id；IndexedDB 只留占位符。
 * - settings 表的 activeProvider 项（键名沿用旧版）指向当前使用的配置 id。
 * - 未配置或当前配置的 Key 无效时，getActiveConfig 返回 undefined，调用方据此走服务端 fallback。
 */
export class LlmSettingsService {
  constructor(private readonly db: YachiyoDatabase) {}

  get(id: string): Promise<LlmSettingsRecord | undefined> {
    return this.db.llmEntries.get(id);
  }

  async put(record: LlmSettingsRecord): Promise<void> {
    await this.db.llmEntries.put(record);
  }

  async clear(id: string): Promise<void> {
    if (isDesktopApp()) {
      void apiFetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    }
    const active = await this.getActiveId();
    await this.db.transaction("rw", this.db.llmEntries, this.db.settings, async () => {
      await this.db.llmEntries.delete(id);
      if (active === id) {
        await this.db.settings.delete(ACTIVE_ENTRY_KEY);
      }
    });
  }

  list(): Promise<LlmSettingsRecord[]> {
    return this.db.llmEntries.toArray();
  }

  async getActiveId(): Promise<string | undefined> {
    const record = await this.db.settings.get(ACTIVE_ENTRY_KEY);
    const value = record?.value;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  async setActive(id: string): Promise<void> {
    await this.db.settings.put({ key: ACTIVE_ENTRY_KEY, value: id });
  }

  async clearActive(): Promise<void> {
    await this.db.settings.delete(ACTIVE_ENTRY_KEY);
  }

  /**
   * 返回当前使用配置的完整信息；若未选择、配置已删或 Key 无效则返回 undefined。
   */
  async getActiveConfig(): Promise<ActiveLlmConfig | undefined> {
    const id = await this.getActiveId();
    if (id === undefined) return undefined;
    const record = await this.db.llmEntries.get(id);
    if (record === undefined) return undefined;
    if (!isValidApiKey(record.apiKey)) return undefined;
    return {
      provider: record.provider,
      apiKey: record.apiKey.trim(),
      model: record.model,
      ...(record.apiKey === KEYSTORE_MANAGED_API_KEY ? { keySlot: record.id } : {}),
      ...(record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {}),
      ...customSettingsOf(record),
    };
  }

  /**
   * 切换某条配置的启用状态，多条可同时启用。
   * 停用当前使用的配置时，自动切到最近更新的另一条已启用配置（没有则清空指针）；
   * 启用时若尚无当前配置，则直接设为当前使用。
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.transaction("rw", this.db.llmEntries, this.db.settings, async () => {
      const record = await this.db.llmEntries.get(id);
      if (record === undefined) return;
      await this.db.llmEntries.put({
        id: record.id,
        provider: record.provider,
        apiKey: record.apiKey,
        model: record.model,
        updatedAt: record.updatedAt,
        ...(record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {}),
        ...(enabled ? {} : { disabled: true }),
        ...customSettingsOf(record),
      });

      const activeValue = (await this.db.settings.get(ACTIVE_ENTRY_KEY))?.value;
      const active = typeof activeValue === "string" ? activeValue : undefined;
      if (enabled) {
        if (active === undefined) {
          await this.db.settings.put({ key: ACTIVE_ENTRY_KEY, value: id });
        }
        return;
      }
      if (active !== id) return;
      const fallback = (await this.db.llmEntries.toArray())
        .filter((item) => item.id !== id && item.disabled !== true)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (fallback === undefined) {
        await this.db.settings.delete(ACTIVE_ENTRY_KEY);
      } else {
        await this.db.settings.put({ key: ACTIVE_ENTRY_KEY, value: fallback.id });
      }
    });
  }

  /** 清除所有模型配置与当前指针（供“清除本地数据”调用） */
  async clearAll(): Promise<void> {
    await this.db.transaction("rw", this.db.llmEntries, this.db.settings, async () => {
      await this.db.llmEntries.clear();
      await this.db.settings.delete(ACTIVE_ENTRY_KEY);
    });
  }

  /**
   * 桌面端：把旧版本以明文存于 IndexedDB 的 Key 迁入网关的系统加密存储，本地只保留占位符。
   * 单条迁移失败时保留原记录，下次启动重试。
   */
  async migrateKeysToKeystore(): Promise<void> {
    if (!isDesktopApp()) return;
    const records = await this.db.llmEntries.toArray();
    for (const record of records) {
      if (record.apiKey === KEYSTORE_MANAGED_API_KEY || !isValidApiKey(record.apiKey)) continue;
      const stored = await storeKeyInKeystore(record.id, record.apiKey.trim(), record.baseUrl).then(
        () => true,
        () => false,
      );
      if (stored) {
        await this.db.llmEntries.put({ ...record, apiKey: KEYSTORE_MANAGED_API_KEY });
      }
    }
  }

  /**
   * 保存一条模型配置并（可选）设为当前使用；不传 id 时新建一条，不会覆盖同厂商的其他配置。
   * 若当前没有任何配置在用且未显式指定 activate，则自动设为当前使用。
   * 带 baseUrl（自定义 OpenAI 兼容端点）时跳过模型白名单，模型名交由上游校验。
   * 桌面端 Key 连同端点一起写入系统加密存储（槽名为配置 id），成功后 IndexedDB 只记录占位符；
   * 传入占位符表示沿用该配置已保存的 Key，此时端点必须与保存时一致。
   * custom（自定义模型设置）只随自定义端点保存，非法字段在边界处丢弃。
   */
  async saveEntry(
    input: {
      id?: string;
      provider: ProviderId;
      apiKey: string;
      model: string;
      baseUrl?: string;
      custom?: CustomModelSettings;
    },
    options: { activate?: boolean } = {},
  ): Promise<LlmSettingsRecord> {
    const { provider } = input;
    const id = input.id ?? newLlmEntryId(provider);
    const existing = input.id === undefined ? undefined : await this.db.llmEntries.get(id);
    if (existing !== undefined && existing.provider !== provider) {
      throw new Error("Provider of an existing entry cannot change");
    }
    const baseUrl = input.baseUrl?.trim() || undefined;
    if (baseUrl !== undefined && !isValidBaseUrl(baseUrl)) {
      throw new Error("Invalid base URL");
    }
    let trimmedKey = input.apiKey.trim();
    if (trimmedKey === KEYSTORE_MANAGED_API_KEY && existing?.apiKey !== KEYSTORE_MANAGED_API_KEY) {
      // 新配置没有可沿用的已存 Key
      throw new Error("API key is required");
    }
    if (isDesktopApp()) {
      if (trimmedKey !== KEYSTORE_MANAGED_API_KEY) {
        await storeKeyInKeystore(id, trimmedKey, baseUrl);
      } else if (existing?.baseUrl !== baseUrl) {
        // 网关只把已存 Key 发往保存时绑定的端点，换端点必须重新提交 Key
        throw new Error("API key must be re-entered when the endpoint changes");
      }
      trimmedKey = KEYSTORE_MANAGED_API_KEY;
    }
    const meta = getProviderMeta(provider);
    const trimmedModel = input.model.trim();
    // 优先采用用户填写的模型名；仅在输入为空时回退为厂商默认模型
    const validModel = trimmedModel.length > 0 ? trimmedModel : meta.defaultModel;
    const record: LlmSettingsRecord = {
      id,
      provider,
      apiKey: trimmedKey,
      model: validModel,
      updatedAt: Date.now(),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(existing?.disabled === true ? { disabled: true } : {}),
      ...(baseUrl !== undefined ? customSettingsOf(input) : {}),
    };
    await this.db.transaction("rw", this.db.llmEntries, this.db.settings, async () => {
      const currentActive = await this.db.settings.get(ACTIVE_ENTRY_KEY);
      const hasActive = typeof currentActive?.value === "string";
      await this.db.llmEntries.put(record);
      if (options.activate === true || (!hasActive && options.activate !== false)) {
        await this.db.settings.put({ key: ACTIVE_ENTRY_KEY, value: id });
      }
    });
    return record;
  }
}

/** 读取记录上的自定义模型设置；IndexedDB 内容可能来自旧版本或被篡改，统一经过校验 */
function customSettingsOf(record: { custom?: unknown }): { custom?: CustomModelSettings } {
  const custom = normalizeCustomModelSettings(record.custom);
  return custom !== undefined ? { custom } : {};
}

/** 供 UI 在没有数据库实例时使用的静态模型列表查询 */
export function modelsFor(provider: ProviderId): readonly string[] {
  return PROVIDER_METADATA[provider].models;
}

/** 写入网关加密存储；provider 字段承载密钥槽名（即配置 id） */
async function storeKeyInKeystore(slot: string, key: string, baseUrl?: string): Promise<void> {
  const response = await apiFetch("/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: slot, key, ...(baseUrl !== undefined ? { baseUrl } : {}) }),
  });
  if (!response.ok) {
    throw new Error(`Failed to store API key (${response.status})`);
  }
}
