import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error?: Error;
  copied: boolean;
}

/** 根组件已把界面语言写入 <html lang>，崩溃后 React 状态不可用时据此选择文案 */
function isJapanese(): boolean {
  return typeof document !== "undefined" && document.documentElement.lang === "ja-JP";
}

/** 渲染异常兜底：避免整窗白屏，并提示数据仍在本地 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { copied: false };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  private readonly handleCopy = async (): Promise<void> => {
    const { error } = this.state;
    if (error === undefined) return;
    try {
      await navigator.clipboard.writeText(error.stack ?? `${error.name}: ${error.message}`);
      this.setState({ copied: true });
    } catch {
      // 剪贴板不可用时保持按钮原样，用户仍可截图反馈
    }
  };

  render(): ReactNode {
    const { error, copied } = this.state;
    if (error === undefined) return this.props.children;
    const ja = isJapanese();
    return (
      <div className="app-error-boundary" role="alert">
        <div className="app-error-boundary__card">
          <img className="app-error-boundary__mark" src="/yachiyo-mark.svg" alt="" aria-hidden="true" />
          <h1>{ja ? "画面で予期しないエラーが発生しました" : "界面出现了意外错误"}</h1>
          <p>
            {ja
              ? "会話履歴はこの端末に保存されているため失われていません。再読み込みをお試しください。"
              : "对话记录保存在本机，不会因此丢失。可以尝试重新加载界面。"}
          </p>
          <code className="app-error-boundary__detail">{error.message}</code>
          <div className="app-error-boundary__actions">
            <button type="button" className="app-error-boundary__primary" onClick={() => window.location.reload()}>
              {ja ? "再読み込み" : "重新加载"}
            </button>
            <button type="button" onClick={() => void this.handleCopy()}>
              {copied ? (ja ? "コピーしました" : "已复制") : ja ? "エラー情報をコピー" : "复制错误信息"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
