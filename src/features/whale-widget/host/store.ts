import Dexie, { type Table } from "dexie";

interface DocRow {
  key: string;
  value: unknown;
}

interface BlobRow {
  id: string;
  blob: Blob;
}

class WhaleDatabase extends Dexie {
  docs!: Table<DocRow, string>;
  blobs!: Table<BlobRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ docs: "key", blobs: "id" });
  }
}

/**
 * 小鲸鱼宿主数据：对应上游 $DSH_HOME 下的 .dshw-*.json 与图片/音频目录。
 * JSON 文档启动时整体读入内存，路由里的「读-改-写」都是同步完成，避免并发请求互相覆盖；
 * 写回 IndexedDB 按调用顺序排队。图片与音频片段以 Blob 存放，按需读取。
 */
export class WhaleStore {
  private readonly db: WhaleDatabase;
  private readonly docs = new Map<string, unknown>();
  private loaded: Promise<void> | null = null;

  constructor(name = "yachiyo-whale-widget") {
    this.db = new WhaleDatabase(name);
  }

  load(): Promise<void> {
    this.loaded ??= this.db.docs.toArray().then((rows) => {
      for (const row of rows) this.docs.set(row.key, row.value);
    });
    return this.loaded;
  }

  get(key: string): unknown {
    return this.docs.get(key);
  }

  /** 内存立即生效；返回的 Promise 在写入 IndexedDB 后完成，失败时由调用方报告保存失败 */
  set(key: string, value: unknown): Promise<void> {
    this.docs.set(key, value);
    return this.db.docs.put({ key, value }).then(() => undefined);
  }

  async readBlob(id: string): Promise<Blob | undefined> {
    return (await this.db.blobs.get(id))?.blob;
  }

  async writeBlob(id: string, blob: Blob): Promise<void> {
    await this.db.blobs.put({ id, blob });
  }

  async deleteBlob(id: string): Promise<void> {
    await this.db.blobs.delete(id);
  }
}
