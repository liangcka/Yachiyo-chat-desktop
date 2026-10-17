import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatMessage, Locale, MessageContentSegment, ToolStep } from "../../domain/chat";
import { ToolCard } from "../tools/ToolCard";
import { MarkdownContent } from "./MarkdownContent";
import { ThinkingBlock } from "./ThinkingBlock";

function parseArguments(json: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function ToolGroup({ steps, streaming, locale }: {
  steps: ReadonlyArray<ToolStep>; streaming: boolean; locale: Locale;
}) {
  const running = streaming && steps.some((step) => step.result === undefined);
  const [isOpen, setIsOpen] = useState(running);
  const prevRunningRef = useRef(running);

  useEffect(() => {
    if (running && !prevRunningRef.current) {
      setIsOpen(true);
    } else if (!running && prevRunningRef.current) {
      setIsOpen(false);
    }
    prevRunningRef.current = running;
  }, [running]);

  const failed = steps.filter((step) => step.result?.isError).length;
  const label = locale === "ja-JP"
    ? `${steps.length} ステップを実行`
    : `已运行 ${steps.length} 步`;

  return (
    <details
      className="message-tool-group"
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="message-tool-group__summary">
        <span>{label}</span>
        {failed > 0 ? <span className="message-tool-group__error">{locale === "ja-JP" ? `${failed} 件失敗` : `${failed} 项失败`}</span> : null}
        <ChevronRight size={13} aria-hidden="true" />
      </summary>
      <div className="message-tool-group__details">
        {steps.map((step) => <ToolCard key={step.id} toolName={step.name}
          args={parseArguments(step.argumentsJson)} output={step.result?.output}
          isError={step.result?.isError} isRunning={streaming && step.result === undefined} locale={locale} />)}
      </div>
    </details>
  );
}

function legacySegments(message: ChatMessage): ReadonlyArray<MessageContentSegment> {
  return [
    ...(message.thought ? [{ type: "thought" as const, start: 0, end: message.thought.length }] : []),
    ...(message.toolSteps ?? []).map((step) => ({ type: "tool" as const, toolId: step.id })),
    ...(message.text ? [{ type: "text" as const, start: 0, end: message.text.length }] : []),
  ];
}

export function MessageContent({ message, locale, hideCitations }: {
  message: ChatMessage; locale: Locale; hideCitations: boolean;
}) {
  const segments = message.contentSegments?.length ? message.contentSegments : legacySegments(message);
  const tools = new Map(message.toolSteps?.map((step) => [step.id, step]));
  const content = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.type === "tool") {
      const steps: ToolStep[] = [];
      const key = index;
      let next: MessageContentSegment | undefined = segment;
      while (next?.type === "tool") {
        const step = tools.get(next.toolId);
        if (step) steps.push(step);
        next = segments[++index];
      }
      index--;
      if (steps.length) content.push(<ToolGroup key={key} steps={steps} locale={locale} streaming={message.status === "streaming"} />);
    } else if (segment.type === "thought") {
      const active = message.status === "streaming" && index === segments.length - 1;
      const durationMs = segment.startedAtMs !== undefined && segment.endedAtMs !== undefined
        ? Math.max(0, segment.endedAtMs - segment.startedAtMs) : undefined;
      content.push(<ThinkingBlock key={index} thought={message.thought?.slice(segment.start, segment.end)}
        locale={locale} hasText={!active} isStreaming={active} durationMs={durationMs} />);
    } else {
      const text = message.text.slice(segment.start, segment.end);
      content.push(<MarkdownContent key={index} text={hideCitations ? text.replace(/\[(\d{1,2})\]/gu, "") : text} isAssistant={message.role === "assistant"} />);
    }
  }
  if (segments.length === 0 && message.status === "streaming") {
    content.push(<ThinkingBlock key="waiting" locale={locale} hasText={false} isStreaming />);
  }
  return <>{content}</>;
}
