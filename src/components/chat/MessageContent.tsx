import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatMessage, Locale, MessageContentSegment, ToolStep } from "../../domain/chat";
import { collectModifiedFiles } from "../../domain/file-changes";
import { summarizeMessageVerification } from "../../domain/verification";
import { ToolCard } from "../tools/ToolCard";
import { FileChangeSummary } from "./FileChangeSummary";
import { RunNotes } from "./RunNotes";
import { RunResultSummary } from "./RunResultSummary";
import { SupplementList } from "./SupplementList";
import { StopCommandContext } from "./review-context";
import { VerificationSummary } from "./VerificationSummary";
import { MarkdownContent } from "./MarkdownContent";
import { ThinkingBlock } from "./ThinkingBlock";
import { processDurationMs, splitContentSegments } from "./content-segments";

function parseArguments(json: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(objB, key) && deepEqual(objA[key], objB[key]));
}

function resolvePendingStepId(
  toolSteps: ReadonlyArray<ToolStep> | undefined,
  pendingPermission?: { toolName: string; argumentsJson?: string; callId?: string },
  pendingToolName?: string,
): string | undefined {
  if (!toolSteps || toolSteps.length === 0) return undefined;
  // 网关给出调用编号时精确定位，不再按工具名与参数猜测
  if (pendingPermission?.callId !== undefined) {
    return toolSteps.some((step) => step.id === pendingPermission.callId) ? pendingPermission.callId : undefined;
  }
  const toolName = pendingPermission?.toolName ?? pendingToolName;
  if (!toolName) return undefined;

  const unfinished = toolSteps.filter((step) => step.name === toolName && step.result === undefined);
  if (unfinished.length === 0) return undefined;

  if (pendingPermission?.argumentsJson !== undefined) {
    const targetArgs = parseArguments(pendingPermission.argumentsJson);
    if (targetArgs !== undefined) {
      const matched = unfinished.find((step) => {
        const stepArgs = parseArguments(step.argumentsJson);
        return stepArgs !== undefined && deepEqual(stepArgs, targetArgs);
      });
      if (matched) return matched.id;
    }
  }

  // 匹配不到时，退回同名的第一个未完成步骤
  return unfinished[0]?.id;
}

/**
 * 只有执行命令/脚本才收进「已运行 N 步」：它的输出要展开看才有意义。
 * 搜索、读规则、读写文件等步骤的标题本身已说明做了什么，直接成行
 */
function isCommandTool(name: string): boolean {
  return name === "run_command";
}

function StepCard({ step, live, locale, pendingStepId }: { step: ToolStep; live: boolean; locale: Locale; pendingStepId?: string }) {
  const stopCommand = useContext(StopCommandContext);
  const running = live && step.result === undefined;
  return <ToolCard toolName={step.name} args={parseArguments(step.argumentsJson)} output={step.result?.output}
    isError={step.result?.isError} isRunning={running}
    isWaitingForApproval={step.id === pendingStepId} locale={locale}
    command={step.result?.command} liveOutput={step.liveOutput}
    onStop={running && step.name === "run_command" && stopCommand !== undefined ? () => stopCommand(step.id) : undefined} />;
}

function ToolGroup({ steps, streaming, locale, pendingStepId }: {
  steps: ReadonlyArray<ToolStep>; streaming: boolean; locale: Locale; pendingStepId?: string;
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
  const label = running
    ? (locale === "ja-JP" ? `${steps.length} ステップを実行中` : `正在运行 ${steps.length} 步`)
    : (locale === "ja-JP" ? `${steps.length} ステップを実行` : `已运行 ${steps.length} 步`);

  return (
    <details
      className="message-tool-group"
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="message-tool-group__summary">
        <span>{label}</span>
        {failed > 0 ? <span className="message-tool-group__error">{locale === "ja-JP" ? `${failed} ステップ失敗` : `${failed} 步失败`}</span> : null}
        <ChevronRight size={13} aria-hidden="true" />
      </summary>
      <div className="message-tool-group__details">
        {steps.map((step) => <StepCard key={step.id} step={step} live={streaming} locale={locale} pendingStepId={pendingStepId} />)}
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

export function MessageContent({ message, locale, hideCitations, pendingPermission, pendingToolName, latest = false }: {
  message: ChatMessage;
  locale: Locale;
  hideCitations: boolean;
  /** 会话中最新的一条回复：结果区提供继续处理的入口 */
  latest?: boolean;
  pendingPermission?: { toolName: string; argumentsJson?: string; callId?: string };
  pendingToolName?: string;
}) {
  const segments = message.contentSegments?.length ? message.contentSegments : legacySegments(message);
  const tools = new Map(message.toolSteps?.map((step) => [step.id, step]));
  const streaming = message.status === "streaming";
  const pendingStepId = streaming
    ? resolvePendingStepId(message.toolSteps, pendingPermission, pendingToolName)
    : undefined;
  const { processSegments, finalSegments } = splitContentSegments(segments);
  const collapseProcess = message.status === "complete" && processSegments.length > 0;
  const modifiedFiles = collectModifiedFiles(message);
  const settled = message.role === "assistant" && message.status !== "streaming" && (message.toolSteps?.length ?? 0) > 0;
  const changes = <>
    {message.runNotes !== undefined ? <RunNotes notes={message.runNotes} locale={locale} latest={latest} /> : null}
    <FileChangeSummary paths={modifiedFiles} locale={locale} {...(message.run !== undefined ? { run: message.run } : {})} settled={settled} />
    {settled ? <VerificationSummary summary={summarizeMessageVerification(message)} modifiedFiles={modifiedFiles.length} locale={locale} /> : null}
    {message.supplements !== undefined ? <SupplementList supplements={message.supplements} locale={locale} /> : null}
    {message.role === "assistant" && message.status !== "streaming" ? <RunResultSummary message={message} locale={locale} latest={latest} /> : null}
  </>;

  function thoughtDurationMs(segment: MessageContentSegment): number | undefined {
    return segment.type === "thought" && segment.startedAtMs !== undefined && segment.endedAtMs !== undefined
      ? Math.max(0, segment.endedAtMs - segment.startedAtMs) : undefined;
  }

  /**
   * 折叠后的过程区里，Agent 连续“思考 → 调工具”的轮次会展开成几十行交替的条目。
   * 中间没有正文的一段思考/工具合并为一条思考 + 一个工具组，思考放在首段思考所在的一侧。
   */
  function renderCoalescedRun(run: ReadonlyArray<MessageContentSegment>, key: number): ReactNode[] {
    const steps = run.flatMap((segment) => {
      const step = segment.type === "tool" ? tools.get(segment.toolId) : undefined;
      return step ? [step] : [];
    });
    const thoughts = run.filter((segment) => segment.type === "thought");
    const toolNodes = renderToolSteps(steps, false);
    if (thoughts.length === 0) return toolNodes;
    const text = thoughts.map((segment) => message.thought?.slice(segment.start, segment.end).trim() ?? "")
      .filter(Boolean).join("\n\n");
    const durations = thoughts.map(thoughtDurationMs).filter((value): value is number => value !== undefined);
    const thinking = <ThinkingBlock key={`${key}-thought`} thought={text} locale={locale} hasText isStreaming={false}
      durationMs={durations.length ? durations.reduce((sum, value) => sum + value, 0) : undefined} />;
    return run[0]?.type === "thought" ? [thinking, ...toolNodes] : [...toolNodes, thinking];
  }

  /** 连续的命令步骤收进同一个「已运行 N 步」组，其余步骤各占一行，保持原有先后顺序 */
  function renderToolSteps(steps: ReadonlyArray<ToolStep>, live: boolean): ReactNode[] {
    const nodes: ReactNode[] = [];
    let commands: ToolStep[] = [];
    const flushCommands = () => {
      if (commands.length) {
        nodes.push(<ToolGroup key={`group-${commands[0]!.id}`} steps={commands} locale={locale} streaming={live} pendingStepId={pendingStepId} />);
      }
      commands = [];
    };
    for (const step of steps) {
      if (isCommandTool(step.name)) {
        commands.push(step);
        continue;
      }
      flushCommands();
      nodes.push(<div key={step.id} className="message-tool-step">
        <StepCard step={step} live={live} locale={locale} pendingStepId={pendingStepId} />
      </div>);
    }
    flushCommands();
    return nodes;
  }

  function renderSegments(parts: ReadonlyArray<MessageContentSegment>, coalesce = false): ReactNode[] {
    const content: ReactNode[] = [];
    for (let index = 0; index < parts.length; index++) {
      const segment = parts[index];
      if (coalesce && segment.type !== "text") {
        const run: MessageContentSegment[] = [];
        const key = index;
        while (parts[index] !== undefined && parts[index].type !== "text") run.push(parts[index++]);
        index--;
        content.push(...renderCoalescedRun(run, key));
      } else if (segment.type === "tool") {
        const steps: ToolStep[] = [];
        let next: MessageContentSegment | undefined = segment;
        while (next?.type === "tool") {
          const step = tools.get(next.toolId);
          if (step) steps.push(step);
          next = parts[++index];
        }
        index--;
        content.push(...renderToolSteps(steps, streaming));
      } else if (segment.type === "thought") {
        const active = streaming && index === parts.length - 1;
        const durationMs = thoughtDurationMs(segment);
        content.push(<ThinkingBlock key={index} thought={message.thought?.slice(segment.start, segment.end)}
          locale={locale} hasText={!active} isStreaming={active} durationMs={durationMs} />);
      } else {
        const text = message.text.slice(segment.start, segment.end);
        content.push(<MarkdownContent key={index} text={hideCitations ? text.replace(/\[(\d{1,2})\]/gu, "") : text} isAssistant={message.role === "assistant"} />);
      }
    }
    return content;
  }
  if (segments.length === 0 && message.status === "streaming") {
    return <>
      <ThinkingBlock locale={locale} hasText={false} isStreaming />
      {message.supplements !== undefined ? <SupplementList supplements={message.supplements} locale={locale} /> : null}
    </>;
  }
  if (!collapseProcess) return <>{renderSegments(segments)}{changes}</>;

  const processSteps = processSegments.flatMap((segment) => {
    const step = segment.type === "tool" ? tools.get(segment.toolId) : undefined;
    return step ? [step] : [];
  });
  const failed = processSteps.filter((step) => step.result?.isError).length;
  const durationMs = processDurationMs(processSegments, message.toolSteps, message.contentStartedAtMs);
  const duration = durationMs === undefined ? "" : locale === "ja-JP"
    ? (durationMs < 1000 ? "1 秒未満で処理 · " : `${Math.round(durationMs / 1000)} 秒で処理 · `)
    : (durationMs < 1000 ? "已处理不到 1 秒 · " : `已处理 ${Math.round(durationMs / 1000)} 秒 · `);
  const stepsLabel = locale === "ja-JP" ? `${processSteps.length} ステップを実行` : `运行 ${processSteps.length} 步`;

  return <>
    <details className="message-process">
      <summary className="message-process__summary">
        <span>{duration}{stepsLabel}</span>
        {failed > 0 ? <span className="message-process__error">{locale === "ja-JP" ? `· ${failed} ステップ失敗` : `· ${failed} 步失败`}</span> : null}
        <ChevronRight size={13} aria-hidden="true" />
      </summary>
      <div className="message-process__content">{renderSegments(processSegments, true)}</div>
    </details>
    {renderSegments(finalSegments)}
    {changes}
  </>;
}
