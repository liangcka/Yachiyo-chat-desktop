import { createContext } from "react";

/** 要审阅的任务改动：运行身份 + 运行实际使用的工作区（可能不是界面当前项目） */
export interface ReviewTarget {
  readonly runId: string;
  readonly workspace: string;
}

/** 打开右侧审阅面板；给出运行时直接审阅该任务的改动，缺省时审阅当前会话最近一次改动文件的任务 */
export const OpenReviewContext = createContext<((target?: ReviewTarget) => void) | undefined>(undefined);

/** 为当前未绑定项目的任务选择并绑定项目；缺省时只切换界面当前项目 */
export const BindProjectContext = createContext<(() => void) | undefined>(undefined);

/** 只停止某条运行中的命令（按工具调用）；缺省时工具卡不提供停止按钮 */
export const StopCommandContext = createContext<((callId: string) => Promise<boolean>) | undefined>(undefined);

/** 以新消息发送给当前会话（继续任务、重发未送达的补充要求）；缺省时不提供这些入口 */
export const FollowUpContext = createContext<((text: string) => void) | undefined>(undefined);
