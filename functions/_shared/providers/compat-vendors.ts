/**
 * 通过自定义 baseUrl 接入的第三方 OpenAI 兼容厂商。
 *
 * 各家沿用 Chat Completions 外形，但思考开关、思考强度与流式思考字段的约定各不相同。
 * 按端点主机名识别厂商，再按模型名套用协议规则；规则须与桌面网关
 * src-tauri/src/gateway/providers/compat_vendor.rs 保持一致。
 */

export type CompatVendor =
  | "ark"
  | "dashscope"
  | "moonshot"
  | "minimax"
  | "mimo"
  | "qianfan"
  | "siliconflow"
  | "openrouter"
  | "xai";

/** 主机名后缀到厂商的映射；按后缀匹配以覆盖区域子域名（如 dashscope-intl、ark.cn-beijing） */
const VENDOR_HOSTS: ReadonlyArray<readonly [string, CompatVendor]> = [
  ["volces.com", "ark"],
  ["bytepluses.com", "ark"],
  ["aliyuncs.com", "dashscope"],
  ["moonshot.cn", "moonshot"],
  ["moonshot.ai", "moonshot"],
  ["minimaxi.com", "minimax"],
  ["minimax.io", "minimax"],
  ["xiaomimimo.com", "mimo"],
  ["baidubce.com", "qianfan"],
  ["siliconflow.cn", "siliconflow"],
  ["siliconflow.com", "siliconflow"],
  ["openrouter.ai", "openrouter"],
  ["x.ai", "xai"],
];

export function detectCompatVendor(baseUrl: string | undefined): CompatVendor | undefined {
  if (baseUrl === undefined) return undefined;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return VENDOR_HOSTS.find(([suffix]) => host === suffix || host.endsWith(`.${suffix}`))?.[1];
}

/** 请求用途：聊天正文，或标题、摘要与联网判定等小预算辅助请求 */
export type CompatPurpose = "chat" | "auxiliary";

type BodyPatch = Readonly<Record<string, unknown>>;

const noPatch: BodyPatch = Object.freeze({});

/** 按厂商与模型给出需要并入请求体的字段；未识别的厂商或模型不做任何改动 */
export function compatVendorBodyPatch(
  vendor: CompatVendor | undefined,
  model: string,
  purpose: CompatPurpose,
): BodyPatch {
  switch (vendor) {
    case "moonshot":
      // K3 思考常驻且不接受 thinking 字段，只能用 reasoning_effort（low/high/max，默认 max）压低档位；
      // K2.6 不支持 reasoning_effort，辅助请求用 thinking 关闭；K2.7 Code 只接受 keep:all 的 thinking，两者都不发
      if (/^kimi-k3/u.test(model)) return { reasoning_effort: "low" };
      if (purpose === "auxiliary" && /^kimi-k2\.6/u.test(model)) return { thinking: { type: "disabled" } };
      return noPatch;
    default:
      return noPatch;
  }
}
