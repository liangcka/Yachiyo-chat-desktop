import Dexie, { type Table } from "dexie";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import type { LlmSettingsRecord, ProviderId } from "../domain/llm";

export type AppSetting =
  | { key: "locale"; value: Locale }
  /** 当前使用的模型配置 id（键名沿用旧版；旧值为厂商名，正好等于迁移后的配置 id） */
  | { key: "activeProvider"; value: string }
  | { key: "activeSkills"; value: string[] }
  | { key: "webSearchEnabled"; value: boolean }
  | { key: "webSearchShowSources"; value: boolean }
  | { key: "webSearchSmart"; value: boolean }
  | { key: "userMemory"; value: string };

export class YachiyoDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<ChatMessage, string>;
  images!: Table<StoredImage, string>;
  settings!: Table<AppSetting, string>;
  /** 旧版按厂商主键的配置表，仅在升级到 v3 时读取迁移 */
  llmSettings!: Table<Omit<LlmSettingsRecord, "id">, ProviderId>;
  llmEntries!: Table<LlmSettingsRecord, string>;

  constructor(name = "yachiyo-chat") {
    super(name);

    this.version(1).stores({
      conversations: "id, updatedAt, locale",
      messages: "id, conversationId, createdAt, [conversationId+createdAt]",
      images: "id, conversationId",
      settings: "key",
    });

    this.version(2).stores({
      conversations: "id, updatedAt, locale",
      messages: "id, conversationId, createdAt, [conversationId+createdAt]",
      images: "id, conversationId",
      settings: "key",
      llmSettings: "provider",
    });

    // v3：模型配置改按 id 存储，同一厂商可配置多条。旧记录以厂商名为 id 迁入，
    // 桌面端加密存储里的 Key 槽名本就是厂商名，迁移后无需重新填写
    this.version(3)
      .stores({
        conversations: "id, updatedAt, locale",
        messages: "id, conversationId, createdAt, [conversationId+createdAt]",
        images: "id, conversationId",
        settings: "key",
        llmSettings: "provider",
        llmEntries: "id, provider",
      })
      .upgrade(async (tx) => {
        const legacy = await tx.table<Omit<LlmSettingsRecord, "id">, ProviderId>("llmSettings").toArray();
        await tx.table<LlmSettingsRecord, string>("llmEntries").bulkPut(legacy.map((record) => ({ ...record, id: record.provider })));
        await tx.table("llmSettings").clear();
      });
  }
}
