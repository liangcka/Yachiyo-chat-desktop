import { useEffect, useRef } from "react";
import type { LlmProviderEntry } from "../../components/LlmSettingsPanel";
import type { ChatMessage } from "../../domain/chat";
import type { ProviderId } from "../../domain/llm";
import { isDesktopApp } from "../../services/app-platform";
import type { WhaleKeyIssue } from "./host/whale-host";
import { ensureWhaleWidget, setWhaleWidgetVisible } from "./runtime";

export interface WhaleWidgetProps {
  entries: readonly LlmProviderEntry[];
  activeProvider?: ProviderId;
  /** 对话阶段：进入 streaming 视为一轮开始，转出视为一轮结束 */
  phase: string;
  messages: readonly ChatMessage[];
  conversationTitle?: string;
  /** Agent 工具等待审批时，挂件按上游的「授权提示」冒泡 */
  pendingPermissionId?: string;
  /** 网关确认 DeepSeek Key 缺失或失效时回调，挂件自身的气泡无法显示原因 */
  onKeyIssue?: (issue: WhaleKeyIssue) => void;
}

/**
 * 余额小鲸鱼：界面与交互完全由上游 DeepSeek-Balance-Whale-Widget 的前端脚本负责，
 * 本组件只把 Key、对话名、审批状态与回复起止同步给本机宿主，卸载时隐藏挂件。
 */
export function WhaleWidget({ entries, activeProvider, phase, messages, conversationTitle, pendingPermissionId, onKeyIssue }: WhaleWidgetProps) {
  // 只认绑定官方端点的 DeepSeek Key，自定义端点的 Key 不会被发往官方余额接口
  const entry = entries.find((item) => item.provider === "deepseek" && item.baseUrl === undefined);
  const hasKey = entry !== undefined;
  const apiKey = isDesktopApp() ? undefined : entry?.apiKey;
  const model = entry?.model;

  useEffect(() => {
    ensureWhaleWidget();
    setWhaleWidgetVisible(true);
    return () => setWhaleWidgetVisible(false);
  }, []);

  useEffect(() => {
    ensureWhaleWidget().setContext({
      apiKey,
      hasKey,
      sessionName: conversationTitle ?? "",
      pending: pendingPermissionId ? { kind: "approval", id: pendingPermissionId } : null,
    });
  }, [apiKey, hasKey, conversationTitle, pendingPermissionId]);

  const onKeyIssueRef = useRef(onKeyIssue);
  useEffect(() => {
    onKeyIssueRef.current = onKeyIssue;
  }, [onKeyIssue]);
  useEffect(() => {
    const host = ensureWhaleWidget();
    host.onKeyIssue((issue) => onKeyIssueRef.current?.(issue));
    return () => host.onKeyIssue(null);
  }, []);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const previousPhaseRef = useRef(phase);
  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (activeProvider !== "deepseek" || model === undefined) return;
    const host = ensureWhaleWidget();
    if (phase === "streaming" && previous !== "streaming") {
      host.beginTurn();
    } else if (previous === "streaming" && phase !== "streaming") {
      const usage = messagesRef.current.filter((message) => message.role === "assistant").at(-1)?.usage;
      const tokens = usage?.totalTokens ?? (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
      void host.endTurn({ model, tokens });
    }
  }, [phase, activeProvider, model]);

  return null;
}
