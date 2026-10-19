/**
 * OpenAI 兼容厂商的协议差异规则。
 *
 * 各家沿用 Chat Completions 外形，但思考开关与思考强度的约定各不相同。按实际生效端点
 * （自定义 baseUrl，否则为厂商默认端点）的主机名识别厂商，再按模型名套用规则；
 * 规则须与桌面网关 src-tauri/src/gateway/providers/compat_vendor.rs 保持一致。
 */

export type CompatVendor =
  | "ark"
  | "dashscope"
  | "moonshot"
  | "minimax"
  | "mimo"
  | "hunyuan"
  | "qianfan"
  | "zhipu"
  | "siliconflow"
  | "openrouter"
  | "xai";

/** 主机名后缀到厂商的映射；按后缀匹配以覆盖区域子域名（如 dashscope-intl、ark.cn-beijing） */
const VENDOR_HOSTS: ReadonlyArray<readonly [string, CompatVendor]> = [
  ["volces.com", "ark"],
  ["bytepluses.com", "ark"],
  ["aliyuncs.com", "dashscope"],
  ["qwencloudapi.com", "dashscope"],
  ["moonshot.cn", "moonshot"],
  ["moonshot.ai", "moonshot"],
  ["minimax.cn", "minimax"],
  ["minimaxi.com", "minimax"],
  ["minimax.io", "minimax"],
  ["xiaomimimo.com", "mimo"],
  ["tencentmaas.com", "hunyuan"],
  ["tencentcloudmaas.com", "hunyuan"],
  ["baidubce.com", "qianfan"],
  ["bigmodel.cn", "zhipu"],
  ["z.ai", "zhipu"],
  ["siliconflow.cn", "siliconflow"],
  ["siliconflow.com", "siliconflow"],
  ["openrouter.ai", "openrouter"],
  ["x.ai", "xai"],
];

export function detectCompatVendor(endpoint: string | undefined): CompatVendor | undefined {
  if (endpoint === undefined) return undefined;
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return VENDOR_HOSTS.find(([suffix]) => host === suffix || host.endsWith(`.${suffix}`))?.[1];
}

/** 请求用途：聊天正文，或标题、摘要与联网判定等小预算辅助请求 */
export type CompatPurpose = "chat" | "auxiliary";

type BodyPatch = Readonly<Record<string, unknown>>;

const noPatch: BodyPatch = Object.freeze({});

/**
 * 千问混合思考模型（默认开启思考）。仅思考的 preview 与早期快照传 enable_thinking:false 会 400，
 * 非思考 instruct 模型传该字段也会 400，因此只匹配确认为混合思考的型号
 */
const QWEN_HYBRID = /^qwen3\.(?:[5-8]-(?:plus|flash)(?:-\d{4}-\d{2}-\d{2})?|8-max(?:-0902)?|7-max)$/u;
/** Qwen3.8 默认 reasoning_effort 为 xhigh，合法取值 low / medium / xhigh */
const QWEN_EFFORT = /^qwen3\.8-(?:max(?:-0902)?|flash)$/u;

/** 按厂商与模型给出需要并入请求体的字段；未识别的厂商或模型不做任何改动 */
export function compatVendorBodyPatch(
  vendor: CompatVendor | undefined,
  model: string,
  purpose: CompatPurpose,
): BodyPatch {
  const auxiliary = purpose === "auxiliary";
  switch (vendor) {
    case "moonshot":
      // K3 思考常驻且不接受 thinking 字段，只能用 reasoning_effort（low/high/max，默认 max）压低档位；
      // K2.6 不支持 reasoning_effort，辅助请求用 thinking 关闭；K2.7 Code 只接受 keep:all 的 thinking，两者都不发
      if (model.startsWith("kimi-k3")) return { reasoning_effort: "low" };
      return auxiliary && model.startsWith("kimi-k2.6") ? { thinking: { type: "disabled" } } : noPatch;
    case "dashscope":
      // 关闭思考时不能再带非 none 的 reasoning_effort，两者互斥
      if (auxiliary) return QWEN_HYBRID.test(model) ? { enable_thinking: false } : noPatch;
      return QWEN_EFFORT.test(model) ? { reasoning_effort: "low" } : noPatch;
    case "minimax":
      return minimaxPatch(model.toLowerCase(), auxiliary);
    case "mimo":
      // MiMo V2.5 起默认开启思考，只能用 thinking.type 开关，没有思考强度字段
      return auxiliary && model.startsWith("mimo-v2") ? { thinking: { type: "disabled" } } : noPatch;
    case "hunyuan":
      // TokenHub 也托管 GLM-5.3 等强制思考模型（传 disabled 会失败），只对混元自家模型生效；
      // hy3 支持 low / high / none，hy4-preview 只支持 high / none
      if (auxiliary) {
        return model.startsWith("hy3") || model.startsWith("hy4") ? { thinking: { type: "disabled" } } : noPatch;
      }
      return model.startsWith("hy3") ? { reasoning_effort: "low" } : noPatch;
    case "qianfan":
      // 文心只有 ernie-5.0-thinking-preview 默认开启思考且可用 enable_thinking 关闭，其余模型的开关未公开
      return auxiliary && model === "ernie-5.0-thinking-preview" ? { enable_thinking: false } : noPatch;
    default:
      return noPatch;
  }
}

function minimaxPatch(model: string, auxiliary: boolean): BodyPatch {
  // M3.1 Flash 思考常开且默认 max，用 reasoning_effort 压低（none 与 thinking.disabled 都会 400）；
  // 它默认已把思考放进 reasoning_content，不支持把 reasoning_split 设为 false，因此不发该字段
  if (model.startsWith("minimax-m3.1-flash")) return { reasoning_effort: "low" };
  // M3 与 M2.x 默认把思考以 <think> 标签混在 content 里，reasoning_split 把它拆到 reasoning_details；
  // M3 的 thinking.type 只接受 adaptive / disabled（enabled 会 400），M2.x 思考关不掉
  if (model.startsWith("minimax-m3")) {
    return auxiliary ? { reasoning_split: true, thinking: { type: "disabled" } } : { reasoning_split: true };
  }
  return model.startsWith("minimax-m2") ? { reasoning_split: true } : noPatch;
}
