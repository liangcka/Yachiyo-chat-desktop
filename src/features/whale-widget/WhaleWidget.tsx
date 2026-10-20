import { RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LlmProviderEntry } from "../../components/LlmSettingsPanel";
import type { Locale } from "../../domain/chat";
import type { ProviderId } from "../../domain/llm";
import { isDesktopApp } from "../../services/app-platform";
import type { WhaleWidgetSettings } from "../../services/plugin-settings";
import { whaleImageUrl } from "./assets";
import {
  BalanceRequestError,
  fetchDeepSeekBalance,
  localDateKey,
  observeBalance,
  type BalanceLedger,
  type DeepSeekBalance,
} from "./balance";
import { peakStatus } from "./peak-hours";
import { WhaleMark } from "./WhaleMark";
import "./whale-widget.css";

const LEDGER_KEY = "yachiyo-whale-ledger";
const POSITION_KEY = "yachiyo-whale-position";
const REFRESH_INTERVAL_MS = 60_000;
/** DeepSeek 扣费落到余额接口有延迟，回复结束后稍等再查 */
const TURN_SETTLE_DELAY_MS = 2_500;
const TURN_TOAST_MS = 6_000;
const DRAG_THRESHOLD_PX = 4;

type Side = "left" | "right";
interface WidgetPosition { side: Side; bottom: number }
const DEFAULT_POSITION: WidgetPosition = { side: "right", bottom: 0 };

const COPY = {
  "zh-CN": {
    label: "余额小鲸鱼",
    title: "DeepSeek 余额",
    refresh: "刷新余额",
    close: "收起",
    granted: "赠金",
    toppedUp: "充值",
    today: "今日已用",
    peak: (left: string) => `高峰时段 · ${left}后转谷价`,
    valley: (left: string) => `谷价时段 · ${left}后进入高峰`,
    noKey: "还没有配置 DeepSeek 官方 API Key",
    configure: "去配置",
    authFailed: "API Key 无效或已失效",
    failed: "暂时取不到余额，稍后自动重试",
    unavailable: "余额不足，调用可能被拒绝",
    turnCost: (amount: string) => `这一轮花了 ${amount}`,
    pillNoKey: "未配置",
    minutes: (m: number) => `${m} 分钟`,
    hours: (h: number, m: number) => (m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`),
    days: (d: number, h: number) => (h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`),
    credit: "形象来自 DeepSeek-Balance-Whale-Widget",
  },
  "ja-JP": {
    label: "残高クジラ",
    title: "DeepSeek 残高",
    refresh: "残高を更新",
    close: "閉じる",
    granted: "付与",
    toppedUp: "チャージ",
    today: "今日の利用",
    peak: (left: string) => `ピーク時間帯 · あと${left}でオフピーク`,
    valley: (left: string) => `オフピーク · あと${left}でピーク`,
    noKey: "DeepSeek 公式 API Key が未設定です",
    configure: "設定する",
    authFailed: "API Key が無効か期限切れです",
    failed: "残高を取得できません。後で自動的に再試行します",
    unavailable: "残高不足のため呼び出しが拒否される可能性があります",
    turnCost: (amount: string) => `今回の消費 ${amount}`,
    pillNoKey: "未設定",
    minutes: (m: number) => `${m} 分`,
    hours: (h: number, m: number) => (m > 0 ? `${h} 時間 ${m} 分` : `${h} 時間`),
    days: (d: number, h: number) => (h > 0 ? `${d} 日 ${h} 時間` : `${d} 日`),
    credit: "イラスト: DeepSeek-Balance-Whale-Widget",
  },
} as const;

function readJson<T>(key: string, accept: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return accept(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式下不持久化，本次会话内照常工作 */
  }
}

function isLedger(value: unknown): value is BalanceLedger {
  const record = value as Partial<BalanceLedger> | null;
  return typeof record?.date === "string" && typeof record.currency === "string"
    && typeof record.lastBalance === "number" && typeof record.todaySpent === "number";
}

function isPosition(value: unknown): value is WidgetPosition {
  const record = value as Partial<WidgetPosition> | null;
  return (record?.side === "left" || record?.side === "right") && typeof record.bottom === "number";
}

function formatMoney(amount: number, currency: string, precise = false): string {
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
  const digits = precise && amount > 0 && amount < 0.01 ? 4 : 2;
  return `${symbol}${amount.toFixed(digits)}`;
}

function formatDuration(ms: number, copy: (typeof COPY)[Locale]): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  if (totalMinutes < 60) return copy.minutes(totalMinutes);
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return copy.hours(totalHours, totalMinutes % 60);
  return copy.days(Math.floor(totalHours / 24), totalHours % 24);
}

export interface WhaleWidgetProps {
  locale: Locale;
  entries: readonly LlmProviderEntry[];
  activeProvider?: ProviderId;
  /** 对话阶段：由 streaming 转出时视为一轮结束 */
  phase: string;
  settings: WhaleWidgetSettings;
  onConfigureKey: () => void;
}

/**
 * 余额小鲸鱼：窗口角落常驻的 DeepSeek 余额挂件，改编自 DeepSeek-Balance-Whale-Widget。
 * 余额经两端同名代理 /api/deepseek/balance 查询；今日已用由余额下降累计；
 * 可拖到左右两侧吸附，贴左时形象水平翻转。
 */
export function WhaleWidget({ locale, entries, activeProvider, phase, settings, onConfigureKey }: WhaleWidgetProps) {
  const copy = COPY[locale];
  const entry = entries.find((item) => item.provider === "deepseek" && item.baseUrl === undefined);
  const hasKey = entry !== undefined;
  const apiKey = isDesktopApp() ? undefined : entry?.apiKey;

  const [balance, setBalance] = useState<DeepSeekBalance | null>(null);
  const [ledger, setLedger] = useState<BalanceLedger | null>(() => readJson(LEDGER_KEY, isLedger));
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [position, setPosition] = useState<WidgetPosition>(() => readJson(POSITION_KEY, isPosition) ?? DEFAULT_POSITION);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [failedVersion, setFailedVersion] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const rootRef = useRef<HTMLDivElement>(null);
  const apiKeyRef = useRef(apiKey);
  const ledgerRef = useRef(ledger);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  /** 查询余额并记账，返回这次观测计入的消费额；失败时保留上次余额 */
  const refresh = useCallback(async (): Promise<number> => {
    setLoading(true);
    try {
      const next = await fetchDeepSeekBalance(apiKeyRef.current);
      const observed = observeBalance(ledgerRef.current, next, localDateKey(new Date()));
      ledgerRef.current = observed.ledger;
      writeJson(LEDGER_KEY, observed.ledger);
      setLedger(observed.ledger);
      setBalance(next);
      setErrorCode(null);
      return observed.spent;
    } catch (error) {
      setErrorCode(error instanceof BalanceRequestError ? error.code : "PROVIDER_ERROR");
      return 0;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    // 首次查询放到下一个任务，避免在 effect 内同步 setState
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [hasKey, refresh]);

  const previousPhaseRef = useRef(phase);
  useEffect(() => {
    const finishedTurn = previousPhaseRef.current === "streaming" && phase !== "streaming";
    previousPhaseRef.current = phase;
    if (!finishedTurn || !hasKey || activeProvider !== "deepseek") return;
    let toastTimer: number | undefined;
    const settleTimer = window.setTimeout(() => {
      void refresh().then((spent) => {
        if (spent <= 0 || !settings.turnCostBubble || ledgerRef.current === null) return;
        setToast(copy.turnCost(formatMoney(spent, ledgerRef.current.currency, true)));
        toastTimer = window.setTimeout(() => setToast(null), TURN_TOAST_MS);
      });
    }, TURN_SETTLE_DELAY_MS);
    return () => {
      window.clearTimeout(settleTimer);
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    };
  }, [phase, hasKey, activeProvider, settings.turnCostBubble, refresh, copy]);

  // 峰谷倒计时按分钟走
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 窗口缩小后把挂件拉回可视区
  useEffect(() => {
    const clamp = () => {
      const height = rootRef.current?.offsetHeight ?? 0;
      setPosition((current) => {
        const maxBottom = Math.max(0, window.innerHeight - height - 8);
        return current.bottom > maxBottom ? { ...current, bottom: maxBottom } : current;
      });
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || rootRef.current === null) return;
    const rect = rootRef.current.getBoundingClientRect();
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (start === null) return;
    if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return;
    start.moved = true;
    setDrag({ left: event.clientX - start.offsetX, top: event.clientY - start.offsetY });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (start === null || !start.moved || rootRef.current === null) return;
    suppressClickRef.current = true;
    const rect = rootRef.current.getBoundingClientRect();
    const side: Side = rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right";
    const bottom = Math.round(Math.min(Math.max(0, window.innerHeight - rect.bottom), window.innerHeight - rect.height - 8));
    const next = { side, bottom: Math.max(0, bottom) };
    setDrag(null);
    setPosition(next);
    writeJson(POSITION_KEY, next);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setExpanded((current) => !current);
    if (hasKey) void refresh();
  };

  const peak = peakStatus(new Date(now));
  const peakText = (peak.peak ? copy.peak : copy.valley)(formatDuration(peak.nextChange.getTime() - now, copy));
  const statusText = !hasKey
    ? copy.noKey
    : errorCode === "PROVIDER_AUTH_FAILED" || errorCode === "API_KEY_MISSING"
      ? copy.authFailed
      : errorCode !== null
        ? copy.failed
        : balance !== null && !balance.available
          ? copy.unavailable
          : null;
  const pillText = !hasKey ? copy.pillNoKey : balance !== null ? formatMoney(balance.total, balance.currency) : "—";
  const assetVersion = settings.assetVersion;
  const imageFailed = failedVersion === assetVersion;

  const style = drag !== null
    ? { left: drag.left, top: drag.top }
    : { [position.side]: 12, bottom: position.bottom };

  return (
    <div
      ref={rootRef}
      className="whale-widget"
      data-side={drag !== null ? undefined : position.side}
      data-dragging={drag !== null ? "" : undefined}
      style={style}
    >
      {toast !== null ? (
        <div className="whale-widget__toast" role="status">{toast}</div>
      ) : null}

      {expanded ? (
        <section className="whale-widget__card" aria-label={copy.title}>
          <header className="whale-widget__card-header">
            <span>{copy.title}</span>
            <span className="whale-widget__card-actions">
              {hasKey ? (
                <button type="button" onClick={() => void refresh()} aria-label={copy.refresh} title={copy.refresh}>
                  <RotateCw size={13} className={loading ? "whale-widget__spin" : undefined} />
                </button>
              ) : null}
              <button type="button" onClick={() => setExpanded(false)} aria-label={copy.close} title={copy.close}>
                <X size={13} />
              </button>
            </span>
          </header>

          {balance !== null ? (
            <>
              <strong className="whale-widget__amount">{formatMoney(balance.total, balance.currency)}</strong>
              <span className="whale-widget__meta">
                {copy.granted} {formatMoney(balance.granted, balance.currency)} · {copy.toppedUp} {formatMoney(balance.toppedUp, balance.currency)}
              </span>
              {ledger !== null && ledger.currency === balance.currency ? (
                <span className="whale-widget__row">
                  <span>{copy.today}</span>
                  <span>{formatMoney(ledger.todaySpent, ledger.currency, true)}</span>
                </span>
              ) : null}
            </>
          ) : null}

          <span className="whale-widget__peak" data-peak={peak.peak ? "" : undefined}>{peakText}</span>

          {statusText !== null ? (
            <p className="whale-widget__status">
              {statusText}
              {!hasKey ? (
                <button type="button" className="whale-widget__link" onClick={onConfigureKey}>{copy.configure}</button>
              ) : null}
            </p>
          ) : null}

          <span className="whale-widget__credit">{copy.credit}</span>
        </section>
      ) : null}

      <span className="whale-widget__pill" aria-hidden="true">{pillText}</span>

      <button
        type="button"
        className="whale-widget__body"
        aria-label={`${copy.label}：${pillText}`}
        aria-expanded={expanded}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragStartRef.current = null; setDrag(null); }}
        onClick={handleClick}
      >
        {imageFailed ? (
          <WhaleMark size={96} className="whale-widget__figure" />
        ) : (
          <img
            className="whale-widget__figure"
            src={whaleImageUrl(assetVersion)}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setFailedVersion(assetVersion)}
          />
        )}
      </button>
    </div>
  );
}
