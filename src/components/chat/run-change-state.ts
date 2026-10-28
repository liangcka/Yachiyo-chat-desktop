import type { RunChangeState } from "../../services/desktop-bridge";

export function runChangeStateLabel(state: RunChangeState, ja: boolean): string {
  switch (state) {
    case "agent":
      return ja ? "未処理" : "待处理";
    case "reviewed":
      return ja ? "処理済み" : "已处理";
    case "reverted":
      return ja ? "取り消し済み" : "已撤销";
    case "conflict":
      return ja ? "競合" : "冲突";
  }
}
