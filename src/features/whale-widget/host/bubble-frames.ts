/**
 * 自定义泡泡框净化，移植自上游 lib/index.js（MIT）。
 * 用户写的 SVG 片段最终会进 innerHTML，落盘前只保留无脚本、无外链的几何标签与属性。
 */
type JsonRecord = Record<string, unknown>;

const FRAME_SVG_TAGS = new Set(["path", "ellipse", "circle", "rect", "polygon", "polyline", "g"]);
const FRAME_SVG_ATTRS = new Set([
  "d", "points", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "fill", "stroke",
  "stroke-width", "stroke-dasharray", "stroke-linejoin", "stroke-linecap", "transform", "opacity", "fill-opacity", "stroke-opacity",
]);
const PAINT_KEYS = ["bgOn", "bg", "bgAlpha", "lineOn", "line", "lineW", "lineAlpha", "dashOn", "dash", "cap", "join"] as const;
const SLOTS = ["big", "small1", "small2"] as const;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : {};
}

function colorOr(value: unknown, fallback: string): string {
  const s = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{3}$/u.test(s) || /^#[0-9a-fA-F]{6}$/u.test(s)) return s;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/u.test(s)) return s;
  if (s === "transparent" || s === "none") return s;
  return fallback;
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  const x = Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
  return Math.round(x * 1000) / 1000;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(String(value) as T) ? (String(value) as T) : fallback;
}

export function sanitizeFrameSvg(code: unknown): string {
  let s = String(code ?? "").slice(0, 8000);
  if (!s) return "";
  s = s.replace(/<\s*(script|foreignObject|style|iframe|image|use|animate|set)\b[\s\S]*?<\s*\/\s*\1\s*>/giu, "");
  s = s.replace(/<\s*(script|foreignObject|style|iframe|image|use|animate|set)\b[^>]*\/?>/giu, "");
  s = s.replace(/<\s*\/?\s*([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gu, (whole: string, tag: string, attrs: string) => {
    if (!FRAME_SVG_TAGS.has(tag)) return "";
    const closing = /^<\s*\//u.test(whole);
    // 内联 SVG 里 <path> 不是空元素，丢掉自闭合斜杠会让后续兄弟被吞进它里面
    const selfClose = /\/\s*>$/u.test(whole);
    let out = `<${closing ? "/" : ""}${tag}`;
    if (!closing) {
      for (const match of attrs.matchAll(/([A-Za-z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/gu)) {
        const name = match[1].toLowerCase();
        const value = match[3] ?? match[4] ?? "";
        if (!FRAME_SVG_ATTRS.has(name)) continue;
        if (/javascript:|url\s*\(|expression\s*\(/iu.test(value) || /[<>]/u.test(value)) continue;
        out += ` ${name}="${value.replace(/"/gu, "&quot;")}"`;
      }
    }
    return out + (selfClose && !closing ? "/>" : ">");
  });
  // 清掉标签之外的裸文本（如未闭合 <script> 残留的代码）
  return s.replace(/[^<>]+(?=<|$)/gu, "");
}

function sanitizePaint(raw: unknown) {
  const paint = asRecord(raw);
  const dash = String(paint.dash ?? "").trim();
  return {
    bgOn: paint.bgOn === undefined ? true : paint.bgOn !== false,
    bg: colorOr(paint.bg, "#FFFFFF"),
    bgAlpha: numberIn(paint.bgAlpha, 1, 0, 1),
    lineOn: paint.lineOn === undefined ? true : paint.lineOn !== false,
    line: colorOr(paint.line, "#203170"),
    lineW: numberIn(paint.lineW, 18, 0, 120),
    lineAlpha: numberIn(paint.lineAlpha, 1, 0, 1),
    dashOn: paint.dashOn === true,
    dash: /^[0-9][0-9.,\s]*$/u.test(dash) ? dash.slice(0, 40) : "0",
    cap: oneOf(paint.cap, ["butt", "square", "round"], "round"),
    join: oneOf(paint.join, ["miter", "bevel", "round"], "round"),
  };
}

function sanitizeSlot(kind: (typeof SLOTS)[number], raw: unknown) {
  const slot = asRecord(raw);
  return {
    dx: numberIn(slot.dx, 0, -1026, 1026),
    dy: numberIn(slot.dy, 0, -700, 700),
    scale: numberIn(slot.scale, 1, 0.2, 4),
    kind: slot.kind === "image" ? "image" : "svg",
    svgPreset: oneOf(slot.svgPreset, ["classic", "roundrect", "zigzag", "custom"], "classic"),
    svgCode: sanitizeFrameSvg(slot.svgCode),
    imgId: String(slot.imgId ?? "").slice(0, 64),
    imgScale: numberIn(slot.imgScale, 1, 0.1, 6),
    imgOpacity: numberIn(slot.imgOpacity, 1, 0, 1),
    paint: sanitizePaint(slot.paint),
    ...(kind === "big" ? {} : { on: slot.on === undefined ? true : slot.on !== false }),
  };
}

function sanitizeFrame(raw: unknown, index: number) {
  const frame = asRecord(raw);
  const slots = asRecord(frame.slots);
  const safe = asRecord(frame.safe);
  const w = numberIn(safe.w, 646, 40, 1026);
  const h = numberIn(safe.h, 400, 40, 700);
  return {
    id: String(frame.id ?? "").trim().slice(0, 64) || `frame_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(frame.name ?? "").trim().slice(0, 24) || `泡泡框${index + 1}`,
    builtin: frame.builtin === true,
    pinned: Math.round(numberIn(frame.pinned, 0, 0, 9999)),
    createdAt: Math.round(numberIn(frame.createdAt, Date.now(), 0, 1e15)),
    textColor: colorOr(frame.textColor, ""),
    safe: { x: numberIn(safe.x, 190, 0, 1026 - w), y: numberIn(safe.y, 90, 0, 700 - h), w, h },
    slots: {
      big: sanitizeSlot("big", slots.big),
      small1: sanitizeSlot("small1", slots.small1),
      small2: sanitizeSlot("small2", slots.small2),
    },
  };
}

/** 内置经典框由前端补齐，不进框库 */
export function sanitizeFrames(list: unknown, defaultId: unknown) {
  const frames = (Array.isArray(list) ? list.slice(0, 50) : [])
    .map((raw, index) => sanitizeFrame(raw, index))
    .filter((frame) => frame.id !== "frame_classic");
  const requested = String(defaultId ?? "").slice(0, 64);
  return { frames, defaultFrameId: frames.some((frame) => frame.id === requested) ? requested : "frame_classic" };
}

function cleanFrameRef(target: unknown): void {
  if (target === null || typeof target !== "object") return;
  const item = target as JsonRecord;
  if (typeof item.frameId === "string") item.frameId = item.frameId.slice(0, 64);
  else delete item.frameId;
  const override = item.frameOverride;
  if (override === null || typeof override !== "object") {
    delete item.frameOverride;
    return;
  }
  const keep: JsonRecord = {};
  for (const slot of SLOTS) {
    const raw = (override as JsonRecord)[slot];
    if (raw === null || typeof raw !== "object") continue;
    const normalized: JsonRecord = sanitizePaint(raw);
    const only: JsonRecord = {};
    for (const key of PAINT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) only[key] = normalized[key];
    }
    keep[slot] = only;
  }
  if (Object.keys(keep).length) item.frameOverride = keep;
  else delete item.frameOverride;
}

/** 泡泡条目上的框引用与外观覆盖逐字段白名单 */
export function sanitizeItemFrames(items: unknown[]): unknown[] {
  for (const raw of items) {
    if (raw === null || typeof raw !== "object") continue;
    cleanFrameRef(raw);
    const item = raw as JsonRecord;
    if (item.kind === "choice" && Array.isArray(item.options)) {
      for (const option of item.options) {
        cleanFrameRef(option);
        cleanFrameRef(asRecord(option).item);
      }
    }
  }
  return items;
}
