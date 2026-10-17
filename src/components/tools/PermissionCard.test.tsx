import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PermissionCard } from "./PermissionCard";

describe("PermissionCard", () => {
  const defaultProps = {
    toolName: "run_command",
    argumentsJson: JSON.stringify({ command: "Get-Content run.ps1", timeout_secs: 20 }),
    onApprove: vi.fn(),
    onDeny: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("正确识别终端命令并渲染微型终端代码舱与元信息", () => {
    render(<PermissionCard {...defaultProps} />);

    expect(screen.getByText("允许运行此命令？")).toBeInTheDocument();
    expect(screen.getByText("终端命令")).toBeInTheDocument();
    expect(screen.getByText("超时 20s")).toBeInTheDocument();
    expect(screen.getByText("Get-Content run.ps1")).toBeInTheDocument();
  });

  it("正确识别文件修改工具并渲染目标路径、说明与详情收纳", () => {
    const fileProps = {
      toolName: "write_file",
      argumentsJson: JSON.stringify({
        path: "src/index.ts",
        Description: "创建核心入口模块",
        content: "console.log('test')",
      }),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    };

    render(<PermissionCard {...fileProps} />);

    expect(screen.getByText("允许修改此文件？")).toBeInTheDocument();
    expect(screen.getByText("文件写入")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("创建核心入口模块")).toBeInTheDocument();
    expect(screen.getByText("详情")).toBeInTheDocument();
  });

  it("通用工具参数与 MCP 规范展示中性文案", () => {
    const genericProps = {
      toolName: "custom_unsafe_tool",
      argumentsJson: JSON.stringify({ foo: "bar" }),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    };

    const { unmount } = render(<PermissionCard {...genericProps} />);
    expect(screen.getByText("允许调用 custom_unsafe_tool 工具？")).toBeInTheDocument();
    expect(screen.getByText("写操作授权")).toBeInTheDocument();
    expect(screen.getByText("custom_unsafe_tool")).toBeInTheDocument();
    unmount();

    const mcpProps = {
      toolName: "mcp__filesystem__write_file",
      argumentsJson: JSON.stringify({ path: "/tmp/test" }),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    };
    render(<PermissionCard {...mcpProps} />);
    expect(screen.getByText("允许调用 filesystem 工具？")).toBeInTheDocument();
    expect(screen.getByText("MCP: filesystem")).toBeInTheDocument();
  });

  it("点击拒绝按钮触发 onDeny", () => {
    const onDeny = vi.fn();
    render(<PermissionCard {...defaultProps} onDeny={onDeny} />);

    fireEvent.click(screen.getByRole("button", { name: /拒绝/ }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("点击允许一次触发 onApprove(false)", () => {
    const onApprove = vi.fn();
    render(<PermissionCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: /允许一次/ }));
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it("点击本会话允许触发 onApprove(true)", () => {
    const onApprove = vi.fn();
    render(<PermissionCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: /本会话允许/ }));
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  it("按下 Esc 键触发 onDeny", () => {
    const onDeny = vi.fn();
    render(<PermissionCard {...defaultProps} onDeny={onDeny} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("按下 Enter 键直接单次允许本次操作", () => {
    const onApprove = vi.fn();
    render(<PermissionCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it("支持日文本地化呈现", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <PermissionCard
        {...defaultProps}
        locale="ja-JP"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );

    expect(screen.getByText("このコマンドの実行を許可しますか？")).toBeInTheDocument();
    expect(screen.getByText("ターミナル")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1回のみ許可/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /このセッション中許可/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /拒否/ })).toBeInTheDocument();
  });

  it("点击复制按钮调用剪贴板 API", async () => {
    render(<PermissionCard {...defaultProps} />);

    const copyBtn = screen.getByRole("button", { name: "复制命令" });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Get-Content run.ps1");
  });
});

