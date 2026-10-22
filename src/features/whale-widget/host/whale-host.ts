import { isDesktopApp } from "../../../services/app-platform";
import { fetchLatestWhaleVersion, WHALE_WIDGET_VERSION, whaleAssetUrl } from "../assets";
import { BalanceRequestError, fetchDeepSeekBalance } from "../balance";
import {
  AccountingError,
  accountingDays,
  addMoney,
  balanceSummary,
  beijingDay,
  daySummary,
  dayOffset,
  freshLedger,
  observeBalance,
  preciseMoney,
  reconcileBalance,
  sumMoney,
  type Ledger,
  type UsageEvent,
} from "./accounting";
import { sanitizeFrames, sanitizeItemFrames } from "./bubble-frames";
import { HOLIDAY_VALLEY_LIST, isPeakTime, nextPeakChangeAt } from "./peak";
import { WhaleStore } from "./store";

/**
 * 小鲸鱼前端脚本所依赖的 /dsh-whale/* 宿主接口在本机的实现，移植自上游 lib/index.js（MIT）。
 * 上游运行在 DeepSeek Harness 的 Node 宿主里读写 $DSH_HOME；这里改为浏览器内的 IndexedDB，
 * 余额经 Yachiyo 两端同名的 /api/deepseek/balance 代理获取，素材按版本从 jsDelivr 加载。
 * 依赖 DSH 自身能力的部分（凭据服务、多厂商余额、Codex 会话统计、提问工具）在此不可用，
 * 对应接口返回明确的不支持说明，挂件其余功能不受影响。
 */

type JsonRecord = Record<string, unknown>;

const VERSION = WHALE_WIDGET_VERSION;
const BALANCE_TTL_MS = 25_000;
/** DeepSeek 扣费落到余额接口有延迟，回复结束后稍等再查 */
const TURN_SETTLE_DELAY_MS = 2_500;
const BUILTIN_MODEL_ID = "deepseek";
const DEFAULT_ROLE_ID = "default";
const NO_KEY_ERROR = "未配置 DeepSeek 官方 API Key（设置 → 模型）";
const UNSUPPORTED_MODEL_ERROR = "Yachiyo 版小鲸鱼只记录内置 DeepSeek 的余额，API Key 请在「设置 → 模型」中管理";

const DOC = {
  size: "size",
  usage: "usage",
  archive: "usage-archive",
  turn: "turn",
  bubble: "bubble",
  roles: "roles",
  audio: "audio",
  bubbleImages: "bubble-images",
} as const;

const PRESET_GROUPS: Record<string, { id: string; name: string; press: string; release: string }> = {
  duck: { id: "duck", name: "小黄鸭", press: "ya1", release: "ya2" },
  fx1: { id: "fx1", name: "音效1", press: "d1", release: "d2" },
};

const PRESET_FRAGMENTS: Record<string, { name: string; file: string; mime: string }> = {
  ya1: { name: "小黄鸭·按下", file: "Ya1.mp3", mime: "audio/mpeg" },
  ya2: { name: "小黄鸭·松开", file: "Ya2.mp3", mime: "audio/mpeg" },
  d1: { name: "音效1·按下", file: "D1.mp3", mime: "audio/mpeg" },
  d2: { name: "音效1·松开", file: "D2.mp3", mime: "audio/mpeg" },
  exp_orb: { name: "Minecraft·经验球", file: "minecraft-exp-orb.wav", mime: "audio/wav" },
  end_a: { name: "A", file: "task-end-a.wav", mime: "audio/wav" },
  cost_a: { name: "每轮消耗·默认", file: "cost-default.wav", mime: "audio/wav" },
  ask_a: { name: "提问·默认", file: "ask-default.wav", mime: "audio/wav" },
  approve_a: { name: "授权·默认", file: "approve-default.wav", mime: "audio/wav" },
};

const DEFAULT_BUBBLE_IMAGES = [
  { id: "bimg_petpet", name: "petpet", file: "bubble-petpet.gif", format: "gif" },
  { id: "bimg_money1", name: "money1", file: "bubble-money1.gif", format: "gif" },
] as const;

const TRANSIENT_BALANCE_CODES = new Set(["NETWORK_ERROR", "PROVIDER_ERROR"]);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function notFound(text: string): Response {
  return new Response(text, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function parseBody(body: string, maxLength: number): JsonRecord {
  if (body.length > maxLength) throw new HttpError(400, "body too large");
  const parsed: unknown = JSON.parse(body || "{}");
  if (parsed === null || typeof parsed !== "object") throw new HttpError(400, "bad body");
  return parsed as JsonRecord;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function base64Size(base64: string): number {
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Tag(text: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
  } catch {
    return "default";
  }
}

/* ── 默认配置：与上游宿主及前端的「恢复默认」逐字段一致 ── */

function waitDefaultLines(kind: "question" | "approval") {
  return [
    { type: "session", size: 10, bold: true, tpl: "[ {session} ]", len: 5, rgb: "champagne", color: "" },
    { type: "text", text: kind === "approval" ? "正在等待老大授权" : "正在等待老大回答", size: 7, bold: true, bgRgb: "", bg: "", rgb: "indigo", color: "" },
  ];
}

function soundEventsDefaults(): JsonRecord {
  return {
    press: { vol: 1 },
    turnCost: { vol: 1, volSet: false, bubbleOn: true },
    question: { on: true, soundOn: false, sel: "frag:ask_a", vol: 1, autoClose: true, ttlSec: 180, bubbleOn: true, lines: waitDefaultLines("question") },
    approval: { on: true, soundOn: false, sel: "frag:approve_a", vol: 1, autoClose: true, ttlSec: 180, bubbleOn: true, lines: waitDefaultLines("approval") },
  };
}

function usageSettingsDefaults() {
  return {
    taskEnd: { on: true, sel: "frag:cost_a" } as JsonRecord,
    subagent: { mute: true } as JsonRecord,
    wait: { charClose: false } as JsonRecord,
    events: soundEventsDefaults(),
    alert: {
      on: true, below: 5,
      msg: "余额预警:当前余额已低于设定值 {below}",
      lines: [
        { type: "text", text: "老大~你的DS余额", size: 5, bold: true },
        { type: "text", text: "已经不足", size: 5, bold: true, row: 2 },
        { type: "text", text: "¥{below}", size: 5, bold: true, rgb: "rouge", color: "", bgRgb: "", bg: "", row: 2 },
        { type: "text", text: "啦~", size: 5, bold: true, row: 2 },
        { type: "image", imgId: "bimg_money1", size: 6, imgScale: 0.4 },
        { type: "link", text: ">> 喂 点 米 <<", url: "https://platform.deepseek.com/top_up", size: 1, color: "#ffffff", rgb: "", bgRgb: "indigo", bg: "", bold: true, ul: false },
      ],
      autoClose: false, ttlSec: 6,
    } as JsonRecord,
    budget: {
      on: true, amount: 10,
      msg: "今日已用已达预算 ¥{amount}",
      lines: [
        { type: "text", text: "老大，今天花销已经超过", size: 6, bold: true, row: 1 },
        { type: "text", text: "¥{amount}", size: 7, bold: true, row: 1, rgb: "rouge", color: "", italic: false, bgRgb: "", bg: "" },
        { type: "text", text: "啦，再花要变成穷光蛋啦...", size: 6, bold: true, row: 1 },
      ],
      autoClose: false, ttlSec: 6,
    } as JsonRecord,
    turnCost: {
      lines: [
        { type: "text", text: "上一轮对话消耗:", size: 8, bold: true },
        { type: "text", text: "¥ {cost}", size: 24, bold: true, color: "#e0433f" },
        { type: "today", size: 2, tpl: "今日已用 {expense_ds}", bold: false, rgb: "", color: "#ffffff", bgRgb: "indigo", bg: "" },
      ],
    } as JsonRecord,
    models: {} as JsonRecord,
  };
}

function quotaDefaults(): JsonRecord {
  return { on: false, mode: "auto", total: 0, unit: "tokens", used: 0, reset: "none", baseAt: 0 };
}

/** 内置 DeepSeek 不参与会话 token 归属，自动额度只剩手填的起始已用 */
function quotaAutoUsed(quota: JsonRecord): number {
  const used = Math.round(Number(quota.used) || 0);
  if (quota.mode === "codex" || (quota.unit === "money" && quota.mode === "auto")) return used;
  return quota.reset === "daily" || quota.reset === "monthly" ? 0 : used;
}

interface SizeConfig {
  scale: number;
  sound: boolean;
  vol: number;
  soundSet: string;
  usageMode: "ledger";
  peakMode: string;
  bubbleOn: boolean;
  pressOn: boolean;
  turnCostOn: boolean;
  turnCostCloseMs: number;
  scrollGapOn: boolean;
  scrollGapPx: number;
  menuBtnHide: boolean;
  codexStatsOn: boolean;
}

interface BalanceOk {
  ok: true;
  totalBalance: number;
  bonusBalance: number;
  rechargeBalance: number;
  currency: string;
  balanceSource: "apikey";
  accountTag: string;
  updatedAt: string;
}

interface BalanceFailure {
  ok: false;
  code: string;
  error: string;
  transient?: boolean;
}

type BalancePayload = BalanceOk | BalanceFailure;

export interface WhalePending {
  kind: "approval" | "question";
  id: string;
}

/** 网关确认的 Key 问题：缺失（未保存或已丢失）或被 DeepSeek 拒绝 */
export type WhaleKeyIssue = "missing" | "rejected";

export interface WhaleHostContext {
  /** 网页版传浏览器本地的 Key；桌面端由网关取系统加密存储里的 Key，这里留空 */
  apiKey?: string;
  hasKey: boolean;
  sessionName: string;
  pending: WhalePending | null;
  /** 挂件隐藏时不再外呼，也不产生新的提示 */
  paused: boolean;
}

interface LastTurn {
  turn: number;
  amount: number;
  tokens: number;
  ts: number;
}

export class WhaleHost {
  private context: WhaleHostContext = { hasKey: false, sessionName: "", pending: null, paused: false };
  private pendingSince = 0;
  private balanceCache: { at: number; payload: BalanceOk } | null = null;
  private balanceInFlight: Promise<JsonRecord> | null = null;
  private balanceLast: JsonRecord | null = null;
  private turnStartBalance: { value: number; currency: string } | null = null;
  private lastTurn: LastTurn | null = null;
  private updateCheckCache: { at: number; payload: JsonRecord } | null = null;
  private readonly imageUrls = new Map<string, Promise<string | null>>();
  private readonly startedAt = Date.now();
  private keyIssue: WhaleKeyIssue | null = null;
  private keyIssueListener: ((issue: WhaleKeyIssue) => void) | null = null;

  constructor(
    private readonly store: WhaleStore = new WhaleStore(),
    private readonly assetFetch: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  setContext(next: Partial<WhaleHostContext>): void {
    if (next.pending !== undefined && next.pending?.id !== this.context.pending?.id) this.pendingSince = Date.now();
    this.context = { ...this.context, ...next };
  }

  /** 上游挂件的气泡显示不了余额失败原因，Key 问题交给宿主应用提示；同一问题持续存在时只通知一次 */
  onKeyIssue(listener: ((issue: WhaleKeyIssue) => void) | null): void {
    this.keyIssueListener = listener;
  }

  private reportKeyIssue(issue: WhaleKeyIssue | null): void {
    const previous = this.keyIssue;
    this.keyIssue = issue;
    if (issue !== null && issue !== previous) this.keyIssueListener?.(issue);
  }

  /* ── 每轮消耗：回复开始时记下余额，结束后按余额下降结算 ── */

  beginTurn(): void {
    const cached = this.balanceCache?.payload;
    this.turnStartBalance = cached ? { value: cached.totalBalance, currency: cached.currency } : null;
  }

  async endTurn(turn: { model: string; tokens: number }): Promise<void> {
    const start = this.turnStartBalance;
    this.turnStartBalance = null;
    if (start === null || this.context.paused || !this.context.hasKey) return;
    await delay(TURN_SETTLE_DELAY_MS);
    const result = await this.getBalance(true);
    if (result.ok !== true || result.stale === true || result.currency !== start.currency) return;
    const amount = Math.max(0, preciseMoney(start.value - Number(result.totalBalance)));
    if (amount <= 0) return;
    await this.store.load();
    const seq = (Number(asRecord(this.store.get(DOC.turn)).seq) || 0) + 1;
    const ts = Date.now();
    this.lastTurn = { turn: seq, amount, tokens: Math.round(turn.tokens), ts };
    await this.store.set(DOC.turn, { seq, updatedAt: new Date(ts).toISOString() }).catch(() => undefined);
    await this.appendUsageEvent({ ts, model: turn.model || "未知", cost: amount, tokens: turn.tokens });
  }

  /** 供 <img> 使用的地址：图片经同一套路由取出后转成同源 Blob URL，挂件才能读像素做命中检测 */
  imageUrl(path: string): Promise<string | null> {
    let pending = this.imageUrls.get(path);
    if (!pending) {
      pending = this.handle(new URL(path, "http://whale.local"))
        .then(async (response) => (response.ok ? URL.createObjectURL(await response.blob()) : null))
        .catch(() => null)
        .then((url) => {
          if (url === null) this.imageUrls.delete(path);
          return url;
        });
      this.imageUrls.set(path, pending);
    }
    return pending;
  }

  private forgetImage(path: string): void {
    const pending = this.imageUrls.get(path);
    this.imageUrls.delete(path);
    void pending?.then((url) => {
      if (url !== null) URL.revokeObjectURL(url);
    });
  }

  async handle(url: URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : "";
    const write = method === "POST" || method === "PUT";
    try {
      await this.store.load();
      switch (url.pathname) {
        case "/dsh-whale/balance.json":
          return json(await this.balanceRoute(url.searchParams.get("refresh") === "1"));
        case "/dsh-whale/last-turn.json":
          return json(this.lastTurn
            ? { ok: true, seq: Number(asRecord(this.store.get(DOC.turn)).seq) || 0, ...this.lastTurn }
            : { ok: true, seq: Number(asRecord(this.store.get(DOC.turn)).seq) || 0, turn: null, amount: null, tokens: null, ts: null });
        case "/dsh-whale/size.json":
          return write ? await this.writeSize(body) : json({ ...this.readSize(), version: VERSION, versionLabel: VERSION });
        case "/dsh-whale/wait.json":
          return json({
            ok: true,
            pending: this.context.pending && !this.context.paused ? { ...this.context.pending, ts: this.pendingSince } : null,
            sessionName: this.context.sessionName,
          });
        case "/dsh-whale/about.json":
          return json(this.aboutPayload());
        case "/dsh-whale/update-check.json":
          return json(await this.updateCheck());
        case "/dsh-whale/usage-records.json":
          return json(this.usageRecordsPayload());
        case "/dsh-whale/balance-adjustments.json":
          return await this.balanceAdjustments(url, method, body);
        case "/dsh-whale/usage-settings.json":
          if (write) {
            const result = await this.writeUsageSettings(parseBody(body, 64 * 1024));
            return json(result, result.ok ? 200 : 400);
          }
          return json({ ok: true, settings: this.readUsageSettings() });
        case "/dsh-whale/api-models.json":
          return write ? await this.apiModelsAction(parseBody(body, 64 * 1024)) : json(await this.apiModelsPayload());
        case "/dsh-whale/image.png":
          return await this.cdnAsset("DSniang1.png", "image/png");
        case "/dsh-whale/rua.gif":
          return await this.cdnAsset("rua.gif", "image/gif");
        case "/dsh-whale/roles.json":
          return write ? await this.uploadRole(body) : json(this.rolesPayload());
        case "/dsh-whale/role-pin.json":
          return await this.pinRole(body);
        case "/dsh-whale/role-delete.json":
          return await this.deleteRole(body);
        case "/dsh-whale/role-image.png":
          return await this.roleImage(url.searchParams.get("id") ?? "");
        case "/dsh-whale/audio.json":
          return write ? await this.audioAction(body) : json(this.audioPayload());
        case "/dsh-whale/audio-fragment":
        case "/dsh-whale/audio-fragment.wav":
          return (await this.fragmentResponse(url.searchParams.get("id") ?? "")) ?? notFound("audio fragment unavailable");
        case "/dsh-whale/sound/press.mp3":
          return await this.soundResponse(url.searchParams.get("set") ?? "", "press");
        case "/dsh-whale/sound/release.mp3":
          return await this.soundResponse(url.searchParams.get("set") ?? "", "release");
        case "/dsh-whale/bubble.json":
          return write ? await this.writeBubble(body) : json({ ok: true, config: this.store.get(DOC.bubble) ?? null });
        case "/dsh-whale/bubble-imgs.json":
          return json(this.bubbleImagesPayload());
        case "/dsh-whale/bubble-img-upload.json":
          return await this.bubbleImageAction(body);
        case "/dsh-whale/bubble-img.png":
          return await this.bubbleImage(url.searchParams.get("id") ?? "");
        default:
          return notFound("not found");
      }
    } catch (error) {
      const status = error instanceof HttpError || error instanceof AccountingError ? error.status : 400;
      return json({ ok: false, error: errorText(error).slice(0, 240) }, status);
    }
  }

  /* ── 余额与记账 ── */

  private ledger(): Ledger {
    const raw = this.store.get(DOC.usage);
    if (raw !== null && typeof raw === "object" && typeof (raw as Ledger).date === "string") {
      const ledger = raw as Ledger;
      ledger.history ??= {};
      return ledger;
    }
    const fresh = freshLedger();
    void this.store.set(DOC.usage, fresh).catch(() => undefined);
    return fresh;
  }

  private async saveLedger(ledger: Ledger): Promise<void> {
    try {
      await this.store.set(DOC.usage, ledger);
    } catch {
      throw new AccountingError("账本保存失败，请检查浏览器存储空间");
    }
  }

  private async balanceRoute(force: boolean): Promise<JsonRecord> {
    const startedAt = Date.now();
    const payload = await this.getBalance(force);
    this.balanceLast = {
      at: Date.now(),
      ms: Date.now() - startedAt,
      ok: payload.ok === true,
      code: String(payload.code ?? ""),
      error: payload.ok === true ? "" : String(payload.error ?? "").slice(0, 160),
      hasBalance: payload.totalBalance !== null && payload.totalBalance !== undefined,
      currency: String(payload.currency ?? ""),
    };
    return { ...payload, version: VERSION, versionLabel: VERSION };
  }

  private getBalance(force: boolean): Promise<JsonRecord> {
    const cached = this.balanceCache;
    if (cached && (this.context.paused || (!force && Date.now() - cached.at < BALANCE_TTL_MS))) {
      return Promise.resolve(this.publicBalance(cached.payload));
    }
    // 挂件隐藏后脚本仍在定时刷新，不能因此外呼
    if (this.context.paused) return Promise.resolve(this.publicBalance({ ok: false, code: "PAUSED", error: "余额小鲸鱼已关闭" }));
    this.balanceInFlight ??= this.fetchBalance()
      .then(async (payload): Promise<JsonRecord> => {
        if (payload.ok) {
          // 账本写不进去不该吞掉已经拿到的余额，只附带说明
          let ledgerError = "";
          try {
            const ledger = this.ledger();
            observeBalance(ledger, {
              balance: payload.totalBalance,
              currency: payload.currency,
              scope: payload.accountTag,
              at: Date.parse(payload.updatedAt),
            });
            this.pruneLedger(ledger);
            await this.saveLedger(ledger);
          } catch (error) {
            ledgerError = errorText(error).slice(0, 160);
          }
          const visible = this.publicBalance(payload);
          this.balanceCache = { at: Date.now(), payload };
          return ledgerError ? { ...visible, ledgerError } : visible;
        }
        if (payload.transient && this.balanceCache) {
          return { ...this.publicBalance(this.balanceCache.payload), stale: true, error: payload.error };
        }
        return this.publicBalance(payload);
      })
      .catch((error: unknown) => ({ ok: false, code: "ERROR", error: `余额服务异常: ${errorText(error).slice(0, 200)}` }))
      .finally(() => {
        this.balanceInFlight = null;
      });
    return this.balanceInFlight;
  }

  private async fetchBalance(): Promise<BalancePayload> {
    if (!this.context.hasKey) return { ok: false, code: "NO_KEY", error: NO_KEY_ERROR };
    let lastCode = "PROVIDER_ERROR";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const balance = await fetchDeepSeekBalance(this.context.apiKey);
        this.reportKeyIssue(null);
        return {
          ok: true,
          totalBalance: balance.total,
          bonusBalance: balance.granted,
          rechargeBalance: balance.toppedUp,
          currency: balance.currency,
          balanceSource: "apikey",
          accountTag: this.context.apiKey ? await sha256Tag(this.context.apiKey) : "default",
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        lastCode = error instanceof BalanceRequestError ? error.code : "PROVIDER_ERROR";
        if (!TRANSIENT_BALANCE_CODES.has(lastCode)) break;
        if (attempt === 0) await delay(500);
      }
    }
    if (lastCode === "API_KEY_MISSING" || lastCode === "PROVIDER_AUTH_FAILED") {
      this.reportKeyIssue(lastCode === "API_KEY_MISSING" ? "missing" : "rejected");
    }
    if (lastCode === "API_KEY_MISSING") return { ok: false, code: "NO_KEY", error: NO_KEY_ERROR };
    const reason = lastCode === "PROVIDER_AUTH_FAILED" ? "API Key 无效或已失效"
      : lastCode === "SESSION_REQUIRED" ? "登录已过期，请重新进入"
        : lastCode === "NETWORK_ERROR" ? "网络连接失败"
          : lastCode;
    return { ok: false, code: "HTTP", transient: TRANSIENT_BALANCE_CODES.has(lastCode), error: `余额接口请求失败: ${reason}` };
  }

  private publicBalance(payload: BalancePayload): JsonRecord {
    const visible: JsonRecord = { ...payload };
    delete visible.accountTag;
    const ledger = this.ledger();
    const today = beijingDay();
    const summary = daySummary(ledger, today);
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      ...visible,
      version: VERSION,
      versionLabel: VERSION,
      isPeak: isPeakTime(nowSec),
      peakNextChangeAt: nextPeakChangeAt(nowSec),
      peakHolidays: HOLIDAY_VALLEY_LIST,
      todayUsage: summary.amount,
      todayUsageCurrency: summary.currency,
      usageSource: summary.source,
      usageLabel: summary.label,
      usageMode: "ledger",
      accounting: balanceSummary(ledger, today),
    };
  }

  /** 逐轮明细保留 90 天或最多 2 万条、逐日汇总保留 365 天，超出部分移入归档文档 */
  private pruneLedger(ledger: Ledger): void {
    const events = ledger.events ?? [];
    const today = beijingDay();
    const cut90 = dayOffset(today, -90);
    const cut365 = dayOffset(today, -365);
    const keep = events.filter((event) => !(event.day && event.day < cut90));
    const drop = events.filter((event) => event.day && event.day < cut90);
    if (keep.length > 20_000) drop.push(...keep.splice(0, keep.length - 20_000));
    const droppedHistory: Record<string, number> = {};
    for (const day of Object.keys(ledger.history)) {
      if (day < cut365) {
        droppedHistory[day] = ledger.history[day];
        delete ledger.history[day];
      }
    }
    if (!drop.length && !Object.keys(droppedHistory).length) return;
    const archive = asRecord(this.store.get(DOC.archive));
    const archivedEvents = [...(Array.isArray(archive.events) ? archive.events : []), ...drop].slice(-200_000);
    void this.store.set(DOC.archive, {
      version: 1,
      events: archivedEvents,
      history: { ...asRecord(archive.history), ...droppedHistory },
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
    ledger.events = keep;
  }

  private async appendUsageEvent(event: { ts: number; model: string; cost: number; tokens: number }): Promise<void> {
    const ledger = this.ledger();
    ledger.events ??= [];
    ledger.events.push({
      ts: event.ts,
      day: beijingDay(event.ts),
      model: event.model,
      cost: preciseMoney(event.cost),
      tokens: Math.round(event.tokens) || 0,
    });
    this.pruneLedger(ledger);
    await this.saveLedger(ledger).catch(() => undefined);
  }

  private usageRecordsPayload(): JsonRecord {
    const ledger = this.ledger();
    const events: UsageEvent[] = ledger.events ?? [];
    const today = beijingDay();
    const modelsFor = (day: string) => {
      const totals = new Map<string, number>();
      for (const event of events) {
        if (event.day !== day) continue;
        const name = String(event.model || "未知");
        totals.set(name, addMoney(totals.get(name) ?? 0, Number(event.cost) || 0));
      }
      return [...totals].map(([model, cost]) => ({ model, cost, source: "events", currency: "CNY" })).sort((a, b) => b.cost - a.cost);
    };
    const forDay = (date: string) => {
      const summary = daySummary(ledger, date);
      const models = modelsFor(date);
      return { ...summary, date, total: summary.amount, models, modelTotal: sumMoney(models.map((m) => m.cost)), modelCurrency: "CNY" };
    };
    const todayData = forDay(today);
    const days7 = Array.from({ length: 7 }, (_, i) => forDay(dayOffset(today, -i)));
    const total7ByCurrency: Record<string, number> = {};
    for (const day of days7) total7ByCurrency[day.currency] = addMoney(total7ByCurrency[day.currency] ?? 0, day.total);
    const days = new Set([today, ...Object.keys(ledger.history), ...accountingDays(ledger)]);
    for (const event of events) if (/^\d{4}-\d{2}-\d{2}$/u.test(event.day)) days.add(event.day);
    return {
      ok: true,
      version: VERSION,
      versionLabel: VERSION,
      today: todayData,
      days7,
      total7: total7ByCurrency[todayData.currency] ?? 0,
      total7Currency: todayData.currency,
      total7ByCurrency,
      all: {
        days: [...days].filter((day) => /^\d{4}-\d{2}-\d{2}$/u.test(day)).sort().reverse().map(forDay),
        events: [...events].sort((a, b) => b.ts - a.ts).slice(0, 500),
      },
      settings: this.readUsageSettings(),
    };
  }

  private async balanceAdjustments(url: URL, method: string, body: string): Promise<Response> {
    const ids = url.searchParams.getAll("modelId");
    if (ids.length !== 1 || ids[0] !== BUILTIN_MODEL_ID) {
      throw new HttpError(403, "余额校正仅支持 DeepSeek（内置），请从该模型的设置菜单进入");
    }
    if (method === "PUT") {
      const input = parseBody(body, 8192);
      if (input.modelId !== BUILTIN_MODEL_ID) throw new HttpError(403, "校正请求的模型不匹配，仅支持 DeepSeek（内置）");
      if (input.day === beijingDay()) {
        const fresh = await this.getBalance(true);
        if (fresh.ok !== true || fresh.stale === true) return json({ ok: false, error: "暂时无法刷新余额，请稍后再保存校正" }, 503);
      }
      const ledger = this.ledger();
      const summary = reconcileBalance(ledger, input);
      await this.saveLedger(ledger);
      this.balanceCache = null;
      return json({ ok: true, summary });
    }
    if (method !== "GET") return json({ ok: false, error: "不支持的请求方法" }, 405);
    const fresh = await this.getBalance(true);
    const ledger = this.ledger();
    return json({
      ok: true,
      days: accountingDays(ledger).sort().reverse().map((day) => balanceSummary(ledger, day)),
      today: beijingDay(),
      fresh: fresh.ok === true && fresh.stale !== true,
      error: fresh.ok !== true || fresh.stale === true ? (fresh.error ?? "余额暂未刷新") : null,
    });
  }

  /* ── 用量设置（任务结束音、余额预警、今日预算、四个提示事件） ── */

  private readUsageSettings() {
    const defaults = usageSettingsDefaults();
    const saved = asRecord(this.ledger().settings);
    for (const key of ["taskEnd", "alert", "budget", "turnCost"] as const) {
      if (saved[key] !== null && typeof saved[key] === "object") defaults[key] = { ...defaults[key], ...asRecord(saved[key]) };
    }
    if (saved.wait !== null && typeof saved.wait === "object") defaults.wait = { ...defaults.wait, charClose: Boolean(asRecord(saved.wait).charClose) };
    if (saved.subagent !== null && typeof saved.subagent === "object") defaults.subagent = { ...defaults.subagent, mute: asRecord(saved.subagent).mute !== false };
    const savedEvents = asRecord(saved.events);
    for (const key of Object.keys(defaults.events)) {
      if (savedEvents[key] !== null && typeof savedEvents[key] === "object") {
        defaults.events[key] = { ...asRecord(defaults.events[key]), ...asRecord(savedEvents[key]) };
      }
    }
    const turnCostEvent = asRecord(defaults.events.turnCost);
    delete turnCostEvent.autoClose;
    delete turnCostEvent.ttlSec;
    const builtinQuota = asRecord(asRecord(asRecord(saved.models)[BUILTIN_MODEL_ID]).quota);
    defaults.models = {
      [BUILTIN_MODEL_ID]: { alert: defaults.alert, budget: defaults.budget, quota: { ...quotaDefaults(), ...builtinQuota } },
    };
    return defaults;
  }

  private async writeUsageSettings(patch: JsonRecord): Promise<JsonRecord> {
    const ledger = this.ledger();
    const settings = asRecord(ledger.settings);
    ledger.settings = settings;
    const merge = (key: string, value: unknown) => {
      if (value !== null && typeof value === "object") settings[key] = { ...asRecord(settings[key]), ...asRecord(value) };
    };
    merge("taskEnd", patch.taskEnd);
    merge("alert", patch.alert);
    merge("budget", patch.budget);
    merge("turnCost", patch.turnCost);
    merge("wait", patch.wait);
    if (patch.subagent !== null && typeof patch.subagent === "object") {
      settings.subagent = { ...asRecord(settings.subagent), mute: asRecord(patch.subagent).mute !== false };
    }
    if (patch.events !== null && typeof patch.events === "object") {
      const events = asRecord(settings.events);
      for (const [key, value] of Object.entries(asRecord(patch.events))) {
        if (value !== null && typeof value === "object") events[key] = { ...asRecord(events[key]), ...asRecord(value) };
      }
      const turnCost = asRecord(events.turnCost);
      delete turnCost.autoClose;
      delete turnCost.ttlSec;
      settings.events = events;
    }
    if (patch.resetEvents === true) {
      settings.events = soundEventsDefaults();
      settings.wait = { charClose: false };
      settings.taskEnd = { on: true, sel: "frag:cost_a" };
    }
    const modelPatch = asRecord(patch.modelSettings);
    if (modelPatch.id) {
      const id = String(modelPatch.id);
      const models = asRecord(settings.models);
      const current = asRecord(models[id]);
      if (modelPatch.alert !== null && typeof modelPatch.alert === "object") current.alert = { ...asRecord(current.alert), ...asRecord(modelPatch.alert) };
      if (modelPatch.budget !== null && typeof modelPatch.budget === "object") current.budget = { ...asRecord(current.budget), ...asRecord(modelPatch.budget) };
      if (modelPatch.quota !== null && typeof modelPatch.quota === "object") {
        const quota = { ...asRecord(modelPatch.quota) };
        // 「重置基准」：内置 DeepSeek 没有会话 token 累计，基准即 0
        if (quota.resetBase) quota.baseAt = 0;
        delete quota.resetBase;
        current.quota = { ...asRecord(current.quota), ...quota };
      }
      models[id] = current;
      settings.models = models;
      if (id === BUILTIN_MODEL_ID) {
        if (current.alert) settings.alert = current.alert;
        if (current.budget) settings.budget = current.budget;
      }
    }
    try {
      await this.saveLedger(ledger);
    } catch {
      return { ok: false, error: "保存失败" };
    }
    return { ok: true, settings: this.readUsageSettings() };
  }

  /* ── 模型列表：只有内置 DeepSeek ── */

  private async apiModelsPayload(): Promise<JsonRecord> {
    const settings = this.readUsageSettings();
    const modelSettings = asRecord(settings.models[BUILTIN_MODEL_ID]);
    const quota = { ...asRecord(modelSettings.quota) };
    quota.autoUsed = quotaAutoUsed(quota);
    quota.autoToday = 0;
    const balanceDesc = { url: "https://api.deepseek.com/user/balance", auth: "Bearer {key}", json: { remaining: "balance_infos[0].total_balance" } };
    const entry: JsonRecord = {
      id: BUILTIN_MODEL_ID, name: "DeepSeek", provider: "deepseek", currency: "CNY",
      keyRef: "DEEPSEEK_API_KEY", builtin: true, baseUrl: "", needsHostConfirm: false, canAdjustBalance: true,
      matchIds: ["deepseek"], settings: modelSettings, price: null, quota,
      balance: null, todayUsage: null, todayUsageCurrency: null, usageSource: "none", error: null,
      balanceDesc, allowCustomHost: false, params: null, balanceMode: "api", hasBalanceApi: true,
      hasKey: this.context.hasKey,
    };
    const payload = await this.getBalance(false);
    if (payload.ok === true) {
      const ledger = this.ledger();
      const summary = daySummary(ledger, beijingDay());
      Object.assign(entry, {
        balance: Number(payload.totalBalance),
        currency: payload.currency,
        todayUsage: summary.amount,
        todayUsageCurrency: summary.currency,
        usageSource: summary.source,
        usageLabel: summary.label,
        accounting: balanceSummary(ledger, beijingDay()),
      });
    } else {
      entry.error = payload.error ?? payload.code ?? "余额获取失败";
    }
    return {
      ok: true,
      builtinId: BUILTIN_MODEL_ID,
      templates: [{
        id: "deepseek", name: "DeepSeek", currency: "CNY", keyRef: "DEEPSEEK_API_KEY", builtin: true, needsBaseUrl: false,
        hasBalance: true, probeUrl: "", kind: "balance", balance: balanceDesc, quota: null, matchIds: [], noBalanceApi: false,
        apiNote: "", sortKey: "deepseek",
      }],
      models: [entry],
    };
  }

  private async apiModelsAction(input: JsonRecord): Promise<Response> {
    const action = String(input.action ?? "save");
    if (action === "model-settings") {
      if (String(input.id ?? "") !== BUILTIN_MODEL_ID) throw new HttpError(400, UNSUPPORTED_MODEL_ERROR);
      const result = await this.writeUsageSettings({ modelSettings: { id: BUILTIN_MODEL_ID, alert: input.alert, budget: input.budget, quota: input.quota } });
      return json(result, result.ok ? 200 : 400);
    }
    if (action === "probe") {
      if (String(input.id ?? "") !== BUILTIN_MODEL_ID) return json({ ok: false, error: "模型不存在" });
      const result = await this.getBalance(true);
      return json(result.ok === true && result.stale !== true
        ? { ok: true, detail: `余额 ${String(result.totalBalance)} ${String(result.currency ?? "CNY")}` }
        : { ok: false, error: result.error ?? result.code });
    }
    throw new HttpError(400, UNSUPPORTED_MODEL_ERROR);
  }

  /* ── 外观设置 ── */

  private readSize(): SizeConfig | Record<string, never> {
    const raw = asRecord(this.store.get(DOC.size));
    if (typeof raw.scale !== "number") return {};
    return {
      scale: raw.scale,
      sound: raw.sound !== false,
      vol: typeof raw.vol === "number" ? raw.vol : 0.9,
      soundSet: typeof raw.soundSet === "string" && raw.soundSet ? raw.soundSet : "duck",
      usageMode: "ledger",
      peakMode: raw.peakMode === "liangwen" || raw.peakMode === "qiangqiang" ? raw.peakMode : "default",
      bubbleOn: raw.bubbleOn !== false,
      pressOn: raw.pressOn !== false,
      turnCostOn: raw.turnCostOn !== false,
      turnCostCloseMs: typeof raw.turnCostCloseMs === "number" ? raw.turnCostCloseMs : 5000,
      scrollGapOn: raw.scrollGapOn === true,
      scrollGapPx: typeof raw.scrollGapPx === "number" ? Math.round(raw.scrollGapPx) : 17,
      menuBtnHide: raw.menuBtnHide === true,
      codexStatsOn: raw.codexStatsOn !== false,
    };
  }

  /** 缺失字段一律沿用现有值，避免不完整的写入把用户设置洗回默认 */
  private async writeSize(body: string): Promise<Response> {
    const parsed = parseBody(body, 8192);
    if (typeof parsed.scale !== "number") return json({ ok: false, error: "missing scale" }, 400);
    const old = asRecord(this.store.get(DOC.size));
    const pickBoolean = (key: string, fallback: boolean) =>
      typeof parsed[key] === "boolean" ? parsed[key] : typeof old[key] === "boolean" ? old[key] : fallback;
    const pickNumber = (key: string, fallback: number) =>
      typeof parsed[key] === "number" ? parsed[key] : typeof old[key] === "number" ? old[key] : fallback;
    const pickString = (key: string, fallback: string) =>
      typeof parsed[key] === "string" && parsed[key] ? parsed[key] : typeof old[key] === "string" && old[key] ? old[key] : fallback;
    const peakMode = typeof parsed.peakMode === "string" ? parsed.peakMode : old.peakMode;
    const turnCostCloseMs = pickNumber("turnCostCloseMs", 5000);
    const scrollGapPx = pickNumber("scrollGapPx", 17);
    const config: SizeConfig = {
      scale: parsed.scale,
      sound: pickBoolean("sound", true),
      vol: pickNumber("vol", 0.9),
      soundSet: pickString("soundSet", "duck"),
      usageMode: "ledger",
      peakMode: peakMode === "liangwen" || peakMode === "qiangqiang" ? peakMode : "default",
      bubbleOn: pickBoolean("bubbleOn", true),
      pressOn: pickBoolean("pressOn", true),
      turnCostOn: pickBoolean("turnCostOn", true),
      turnCostCloseMs: turnCostCloseMs > 0 ? turnCostCloseMs : 0,
      scrollGapOn: pickBoolean("scrollGapOn", false),
      scrollGapPx: scrollGapPx > 0 ? Math.round(scrollGapPx) : 0,
      menuBtnHide: pickBoolean("menuBtnHide", false),
      codexStatsOn: pickBoolean("codexStatsOn", true),
    };
    try {
      await this.store.set(DOC.size, { ...config, updatedAt: new Date().toISOString() });
    } catch (error) {
      return json({ ok: false, error: `无法持久化挂件尺寸：${errorText(error)}` }, 500);
    }
    return json({ ok: true, ...config });
  }

  /* ── 关于 / 检查更新 ── */

  private aboutPayload(): JsonRecord {
    const docRow = (label: string, key: string) => {
      const value = this.store.get(key);
      return {
        label,
        found: value !== undefined,
        path: value !== undefined ? `IndexedDB · ${key}` : "",
        candidates: 1,
        bytes: value !== undefined ? JSON.stringify(value).length : null,
        mtime: null,
      };
    };
    const ledger = this.ledger();
    const summary = daySummary(ledger, beijingDay());
    const desktop = isDesktopApp();
    const builtIn = { found: true, path: "Yachiyo Chat 内置", bytes: null, mtime: null };
    return {
      ok: true,
      plugin: { name: "dsh-whale-widget", version: VERSION, channel: "release", label: VERSION, hostVersionLiterals: [VERSION, VERSION] },
      build: { host: builtIn, widget: builtIn, hostHasDevPaths: false },
      runtime: {
        platform: desktop ? "desktop" : "web",
        arch: "browser",
        node: "浏览器内宿主",
        dsh: "Yachiyo Chat",
        uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
        dataHome: "IndexedDB · yachiyo-whale-widget",
        profile: "",
      },
      client: { kind: desktop ? "desktop" : "web", via: "yachiyo" },
      data: [
        docRow("账本（记账）", DOC.usage),
        docRow("泡泡配置", DOC.bubble),
        docRow("外观/设置", DOC.size),
        docRow("轮次序号", DOC.turn),
      ],
      ledger: {
        days: accountingDays(ledger).length,
        todayPartial: Boolean(summary.partialDay),
        todaySource: summary.source,
        lastObservedAt: "lastObservedAt" in summary ? summary.lastObservedAt : null,
        needsReview: "needsReview" in summary ? Boolean(summary.needsReview) : false,
      },
      balance: this.balanceLast,
      codex: { enabled: false, reason: "Yachiyo 不读取本机 Codex 会话" },
    };
  }

  private async updateCheck(): Promise<JsonRecord> {
    const now = Date.now();
    if (this.updateCheckCache && now - this.updateCheckCache.at < 10 * 60 * 1000) return this.updateCheckCache.payload;
    let payload: JsonRecord;
    try {
      const latest = await fetchLatestWhaleVersion(this.assetFetch);
      payload = { ok: true, current: VERSION, channel: "release", latest, hasUpdate: latest !== VERSION, source: "jsdelivr" };
    } catch (error) {
      payload = { ok: false, current: VERSION, error: `jsdelivr：${errorText(error).slice(0, 40)}`, tried: ["jsdelivr"] };
    }
    this.updateCheckCache = { at: now, payload };
    return payload;
  }

  /* ── 素材：内置文件走 CDN，用户上传的存 IndexedDB ── */

  /** 版本化的 CDN 地址内容不变，交给浏览器 HTTP 缓存；离线时与上游缺素材一样返回 404，由挂件静默降级 */
  private async cdnAsset(file: string, mime: string): Promise<Response> {
    try {
      const response = await this.assetFetch(whaleAssetUrl(file));
      if (response.ok) return this.blobResponse(await response.blob(), mime);
    } catch {
      /* 网络不可达 */
    }
    return notFound(`${file} unavailable`);
  }

  private blobResponse(blob: Blob, mime: string): Response {
    return new Response(blob, { headers: { "content-type": mime, "cache-control": "no-store" } });
  }

  private rolesIndex(): { version: number; roles: JsonRecord[] } {
    const raw = asRecord(this.store.get(DOC.roles));
    const roles = Array.isArray(raw.roles) ? (raw.roles as JsonRecord[]) : [];
    if (!roles.some((role) => role?.id === DEFAULT_ROLE_ID)) roles.unshift({ id: DEFAULT_ROLE_ID, name: "小鲸鱼", pinnedAt: 1, createdAt: 0 });
    return { version: 1, roles };
  }

  private rolesPayload(): JsonRecord {
    const pinnedAt = (role: JsonRecord) => (Number(role.pinnedAt) > 0 ? Number(role.pinnedAt) : 0);
    const roles = [...this.rolesIndex().roles].sort((a, b) => {
      const ap = pinnedAt(a);
      const bp = pinnedAt(b);
      if (ap && bp) return bp - ap;
      if (ap) return -1;
      if (bp) return 1;
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    return {
      ok: true,
      roles: roles.map((role) => ({
        id: role.id,
        name: String(role.name || role.id),
        url: role.id === DEFAULT_ROLE_ID ? "/dsh-whale/image.png" : `/dsh-whale/role-image.png?id=${encodeURIComponent(String(role.id))}`,
        pinned: pinnedAt(role) > 0,
        pinnedAt: role.pinnedAt || null,
        createdAt: role.createdAt || null,
        format: role.format === "gif" || role.format === "apng" ? role.format : "png",
      })),
    };
  }

  private async uploadRole(body: string): Promise<Response> {
    const parsed = parseBody(body, 30 * 1024 * 1024);
    const name = String(parsed.name ?? "").trim().slice(0, 20) || "新角色";
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/u.exec(String(parsed.image ?? ""));
    if (!match) return json({ ok: false, error: "invalid image data" }, 400);
    const size = base64Size(match[2]);
    if (size < 8 || size > 20 * 1024 * 1024) return json({ ok: false, error: "image too large" }, 400);
    // APNG 的 dataURL 也是 image/png，格式由前端显式告知
    const format = parsed.format === "gif" ? "gif" : parsed.format === "apng" ? "apng" : match[1] === "gif" ? "gif" : "png";
    const id = newId("role");
    await this.store.writeBlob(`role:${id}`, base64ToBlob(match[2], format === "gif" ? "image/gif" : "image/png"));
    const index = this.rolesIndex();
    index.roles.push({ id, name, format, pinnedAt: null, createdAt: Date.now() });
    await this.store.set(DOC.roles, index);
    return json(this.rolesPayload());
  }

  private async pinRole(body: string): Promise<Response> {
    const parsed = parseBody(body, 8192);
    const index = this.rolesIndex();
    const role = index.roles.find((item) => item.id === String(parsed.id ?? ""));
    if (!role) return json({ ok: false, error: "role not found" }, 404);
    role.pinnedAt = parsed.pinned === true ? Date.now() : null;
    await this.store.set(DOC.roles, index);
    return json(this.rolesPayload());
  }

  private async deleteRole(body: string): Promise<Response> {
    const id = String(parseBody(body, 8192).id ?? "");
    if (id === DEFAULT_ROLE_ID) return json({ ok: false, error: "cannot delete default role" }, 400);
    const index = this.rolesIndex();
    if (!index.roles.some((role) => role.id === id)) return json({ ok: false, error: "role not found" }, 404);
    index.roles = index.roles.filter((role) => role.id !== id);
    await this.store.set(DOC.roles, index);
    await this.store.deleteBlob(`role:${id}`);
    this.forgetImage(`/dsh-whale/role-image.png?id=${encodeURIComponent(id)}`);
    return json(this.rolesPayload());
  }

  private async roleImage(id: string): Promise<Response> {
    const role = this.rolesIndex().roles.find((item) => item.id === id);
    const blob = role && id !== DEFAULT_ROLE_ID ? await this.store.readBlob(`role:${id}`) : undefined;
    if (!blob) return notFound("role image unavailable");
    return this.blobResponse(blob, role?.format === "gif" ? "image/gif" : "image/png");
  }

  private audioIndex(): { version: number; groups: JsonRecord[]; fragments: JsonRecord[] } {
    const raw = asRecord(this.store.get(DOC.audio));
    return {
      version: 1,
      groups: Array.isArray(raw.groups) ? (raw.groups as JsonRecord[]) : [],
      fragments: Array.isArray(raw.fragments) ? (raw.fragments as JsonRecord[]) : [],
    };
  }

  private audioFragmentsPayload(): JsonRecord[] {
    const presets = Object.entries(PRESET_FRAGMENTS).map(([id, fragment]) => ({ id, name: fragment.name, preset: true }));
    const custom = this.audioIndex().fragments.map((fragment) => ({
      id: fragment.id,
      name: String(fragment.name || fragment.id),
      preset: false,
      createdAt: fragment.createdAt || null,
    }));
    return [...presets, ...custom];
  }

  /** 置顶的自定义组在前，其次预设组，最后未置顶的自定义组（按创建时间倒序） */
  private audioGroupsPayload(): JsonRecord[] {
    const custom = this.audioIndex().groups.map((group) => ({
      id: group.id,
      name: String(group.name || group.id),
      press: typeof group.press === "string" ? group.press : null,
      release: typeof group.release === "string" ? group.release : null,
      preset: false,
      pinned: Number(group.pinnedAt) > 0,
      pinnedAt: group.pinnedAt || null,
      createdAt: Number(group.createdAt) || 0,
    }));
    const pinned = custom.filter((group) => group.pinned).sort((a, b) => Number(b.pinnedAt) - Number(a.pinnedAt));
    const unpinned = custom.filter((group) => !group.pinned).sort((a, b) => b.createdAt - a.createdAt);
    const presets = Object.values(PRESET_GROUPS).map((group) => ({ ...group, preset: true, pinned: false, pinnedAt: null, createdAt: 0 }));
    return [...pinned, ...presets, ...unpinned];
  }

  private audioPayload(): JsonRecord {
    return { ok: true, groups: this.audioGroupsPayload(), fragments: this.audioFragmentsPayload() };
  }

  private async audioAction(body: string): Promise<Response> {
    const parsed = parseBody(body, 8 * 1024 * 1024);
    const index = this.audioIndex();
    const id = String(parsed.id ?? "");
    switch (parsed.action) {
      case "upload-fragment": {
        const name = String(parsed.name ?? "").trim().slice(0, 40) || "未命名音频";
        const match = /^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/u.exec(String(parsed.audio ?? ""));
        if (!match) return json({ ok: false, error: "invalid wav data" }, 400);
        const size = base64Size(match[1]);
        if (size < 44 || size > 8 * 1024 * 1024) return json({ ok: false, error: "audio too large" }, 400);
        const fragmentId = newId("audio");
        await this.store.writeBlob(`audio:${fragmentId}`, base64ToBlob(match[1], "audio/wav"));
        index.fragments.push({ id: fragmentId, name, createdAt: Date.now() });
        await this.store.set(DOC.audio, index);
        return json({ ok: true, id: fragmentId, fragments: this.audioFragmentsPayload() });
      }
      case "save-group": {
        const name = String(parsed.name ?? "").trim().slice(0, 20) || "未命名音效组";
        // 空字符串表示该槽留空（该事件静音）；引用了不存在的片段时回退到小黄鸭
        const known = new Set(this.audioFragmentsPayload().map((fragment) => String(fragment.id)));
        const slot = (value: unknown, fallback: string) => {
          const ref = String(value ?? "");
          return ref === "" ? "" : known.has(ref) ? ref : fallback;
        };
        const press = slot(parsed.press, PRESET_GROUPS.duck.press);
        const release = slot(parsed.release, PRESET_GROUPS.duck.release);
        const existing = id ? index.groups.find((group) => group.id === id) : undefined;
        if (existing) Object.assign(existing, { name, press, release });
        else index.groups.push({ id: newId("group"), name, press, release, pinnedAt: null, createdAt: Date.now() });
        await this.store.set(DOC.audio, index);
        return json({ ok: true, groups: this.audioGroupsPayload() });
      }
      case "delete-group":
        if (PRESET_GROUPS[id]) return json({ ok: false, error: "cannot delete preset group" }, 400);
        index.groups = index.groups.filter((group) => group.id !== id);
        await this.store.set(DOC.audio, index);
        return json({ ok: true, groups: this.audioGroupsPayload() });
      case "delete-fragment":
        if (PRESET_FRAGMENTS[id]) return json({ ok: false, error: "cannot delete preset fragment" }, 400);
        index.fragments = index.fragments.filter((fragment) => fragment.id !== id);
        await this.store.set(DOC.audio, index);
        await this.store.deleteBlob(`audio:${id}`);
        return json({ ok: true, fragments: this.audioFragmentsPayload(), groups: this.audioGroupsPayload() });
      case "pin-group": {
        const group = index.groups.find((item) => item.id === id);
        if (!group) return json({ ok: false, error: "group not found" }, 404);
        group.pinnedAt = parsed.pinned === true ? Date.now() : null;
        await this.store.set(DOC.audio, index);
        return json({ ok: true, groups: this.audioGroupsPayload() });
      }
      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
  }

  private async fragmentResponse(id: string): Promise<Response | null> {
    const preset = PRESET_FRAGMENTS[id];
    if (preset) {
      const response = await this.cdnAsset(preset.file, preset.mime);
      return response.ok ? response : null;
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id)) return null;
    const blob = await this.store.readBlob(`audio:${id}`);
    return blob ? this.blobResponse(blob, "audio/wav") : null;
  }

  /** 预设组直接取对应片段；自定义组引用的片段被删时回退小黄鸭，槽位留空则返回 204 静音 */
  private async soundResponse(set: string, slot: "press" | "release"): Promise<Response> {
    let fragmentId = PRESET_GROUPS[set]?.[slot];
    if (!fragmentId) {
      const custom = this.audioIndex().groups.find((group) => group.id === set);
      const ref = custom?.[slot];
      if (ref === "") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      const exists = typeof ref === "string" && (PRESET_FRAGMENTS[ref] || this.audioIndex().fragments.some((fragment) => fragment.id === ref));
      fragmentId = exists ? String(ref) : PRESET_GROUPS.duck[slot];
    }
    return (await this.fragmentResponse(fragmentId))
      ?? (await this.fragmentResponse(PRESET_GROUPS.duck[slot]))
      ?? notFound("sound unavailable");
  }

  private async writeBubble(body: string): Promise<Response> {
    const parsed = parseBody(body, 512 * 1024);
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.lib)) return json({ ok: false, error: "invalid bubble config" }, 400);
    const config: JsonRecord = { v: 1, items: sanitizeItemFrames(parsed.items), lib: parsed.lib, tapAdvance: parsed.tapAdvance === true };
    if (Array.isArray(parsed.frames)) Object.assign(config, sanitizeFrames(parsed.frames, parsed.defaultFrameId));
    await this.store.set(DOC.bubble, config);
    return json({ ok: true, config });
  }

  private bubbleImageIndex(): { version: number; images: JsonRecord[] } {
    const raw = asRecord(this.store.get(DOC.bubbleImages));
    return { version: 1, images: Array.isArray(raw.images) ? (raw.images as JsonRecord[]) : [] };
  }

  private bubbleImagesPayload(): JsonRecord {
    const images = this.bubbleImageIndex().images;
    const seen = new Set(images.map((image) => image.id));
    const builtins = DEFAULT_BUBBLE_IMAGES.filter((image) => !seen.has(image.id)).map((image) => ({
      id: image.id,
      name: image.name,
      format: image.format,
      url: `/dsh-whale/bubble-img.png?id=${encodeURIComponent(image.id)}`,
      createdAt: null,
      builtin: true,
    }));
    const custom = [...images]
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .map((image) => ({
        id: image.id,
        name: String(image.name || image.id),
        format: image.format === "gif" ? "gif" : "png",
        url: `/dsh-whale/bubble-img.png?id=${encodeURIComponent(String(image.id))}`,
        createdAt: image.createdAt || null,
      }));
    return { ok: true, images: [...builtins, ...custom] };
  }

  private async bubbleImageAction(body: string): Promise<Response> {
    const parsed = parseBody(body, 12 * 1024 * 1024);
    const index = this.bubbleImageIndex();
    if (parsed.action === "upload") {
      const name = String(parsed.name ?? "").trim().slice(0, 40);
      const match = /^data:image\/(png|gif);base64,([A-Za-z0-9+/=]+)$/u.exec(String(parsed.data ?? ""));
      if (!match) return json({ ok: false, error: "invalid image data" }, 400);
      const size = base64Size(match[2]);
      if (size < 64 || size > 8 * 1024 * 1024) return json({ ok: false, error: "image too large" }, 400);
      const format = match[1] === "gif" ? "gif" : "png";
      const id = newId("bimg");
      await this.store.writeBlob(`bimg:${id}`, base64ToBlob(match[2], `image/${format}`));
      index.images.push({ id, name, format, createdAt: Date.now() });
      await this.store.set(DOC.bubbleImages, index);
      return json(this.bubbleImagesPayload());
    }
    if (parsed.action === "delete") {
      const id = String(parsed.id ?? "");
      if (!index.images.some((image) => image.id === id)) return json({ ok: false, error: "image not found" }, 404);
      index.images = index.images.filter((image) => image.id !== id);
      await this.store.set(DOC.bubbleImages, index);
      await this.store.deleteBlob(`bimg:${id}`);
      this.forgetImage(`/dsh-whale/bubble-img.png?id=${encodeURIComponent(id)}`);
      return json(this.bubbleImagesPayload());
    }
    return json({ ok: false, error: "unknown action" }, 400);
  }

  private async bubbleImage(id: string): Promise<Response> {
    const image = this.bubbleImageIndex().images.find((item) => item.id === id);
    if (image) {
      const blob = await this.store.readBlob(`bimg:${id}`);
      if (blob) return this.blobResponse(blob, image.format === "gif" ? "image/gif" : "image/png");
    }
    const builtin = DEFAULT_BUBBLE_IMAGES.find((item) => item.id === id);
    if (builtin) return await this.cdnAsset(builtin.file, `image/${builtin.format}`);
    return notFound("bubble image unavailable");
  }
}
