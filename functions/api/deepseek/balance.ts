import {
  isAllowedOrigin,
  isJsonRequest,
  jsonResponse,
  problemResponse,
} from "../../_shared/http";
import { isValidApiKey } from "../../_shared/providers/registry";
import {
  resolveSessionSigningSecret,
  sessionFromRequest,
} from "../../_shared/session";
import { readJsonBodyWithLimit } from "../../_shared/validation";

interface BalanceContext {
  request: Request;
  env: Env;
}

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const MAXIMUM_BODY_BYTES = 1_024;
const UPSTREAM_TIMEOUT_MS = 15_000;

/** mock 模式不外呼，返回固定余额，供本地联调与 E2E 展示挂件 */
const MOCK_BALANCE = {
  is_available: true,
  balance_infos: [
    { currency: "CNY", total_balance: "88.80", granted_balance: "8.80", topped_up_balance: "80.00" },
  ],
};

/**
 * 余额小鲸鱼插件的 DeepSeek 余额代理：网页版的 Key 只存在浏览器本地，
 * 由会话校验后的同源请求转交给 DeepSeek，成功时原样返回 /user/balance 的 JSON，
 * 解析与币种选择统一在前端完成，与桌面网关的同名路由共用一套契约。
 */
export async function onRequestPost(context: BalanceContext): Promise<Response> {
  if (!isAllowedOrigin(context.request)) {
    return problemResponse("ORIGIN_NOT_ALLOWED", 403);
  }
  if (!isJsonRequest(context.request)) {
    return problemResponse("INVALID_REQUEST", 400);
  }

  const signingSecret = resolveSessionSigningSecret(context.env);
  if (signingSecret === null) {
    return problemResponse("CONFIGURATION_ERROR", 503);
  }
  if ((await sessionFromRequest(context.request, signingSecret)) === null) {
    return problemResponse("SESSION_REQUIRED", 401);
  }

  let apiKey: unknown;
  try {
    const body = await readJsonBodyWithLimit(context.request, MAXIMUM_BODY_BYTES);
    apiKey = typeof body === "object" && body !== null ? (body as { apiKey?: unknown }).apiKey : undefined;
  } catch {
    return problemResponse("INVALID_REQUEST", 400);
  }

  if (context.env.APP_MODE === "mock") {
    return jsonResponse(MOCK_BALANCE);
  }
  if (!isValidApiKey(apiKey)) {
    return problemResponse("INVALID_REQUEST", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK_BALANCE_URL, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey.trim()}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return problemResponse("PROVIDER_ERROR", 502);
  }

  if (upstream.status === 401 || upstream.status === 403) {
    return problemResponse("PROVIDER_AUTH_FAILED", 401);
  }
  if (!upstream.ok) {
    return problemResponse("PROVIDER_ERROR", 502);
  }

  try {
    return jsonResponse(await upstream.json());
  } catch {
    return problemResponse("PROVIDER_ERROR", 502);
  }
}
