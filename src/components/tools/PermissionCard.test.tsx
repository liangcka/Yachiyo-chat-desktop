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

    expect(screen.getByText("八千代请求执行终端命令")).toBeInTheDocument();
    expect(screen.getByText("终端命令")).toBeInTheDocument();
    expect(screen.getByText("超时 20s")).toBeInTheDocument();
    expect(screen.getByText("Get-Content run.ps1")).toBeInTheDocument();
  });

  it("正确识别文件修改工具并渲染目标路径", () => {
    const fileProps = {
      toolName: "write_file",
      argumentsJson: JSON.stringify({ path: "src/index.ts", content: "console.log('test')" }),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    };

    render(<PermissionCard {...fileProps} />);

    expect(screen.getByText("八千代请求修改工作区文件")).toBeInTheDocument();
    expect(screen.getByText("文件写入")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });

  it("通用工具参数展示回退", () => {
    const genericProps = {
      toolName: "custom_unsafe_tool",
      argumentsJson: JSON.stringify({ foo: "bar" }),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    };

    render(<PermissionCard {...genericProps} />);

    expect(screen.getByText("八千代请求执行写操作")).toBeInTheDocument();
    expect(screen.getByText("写操作授权")).toBeInTheDocument();
    expect(screen.getByText("custom_unsafe_tool")).toBeInTheDocument();
  });

  it("点击拒绝按钮触发 onDeny", () => {
    const onDeny = vi.fn();
    render(<PermissionCard {...defaultProps} onDeny={onDeny} />);

    fireEvent.click(screen.getByRole("button", { name: /拒绝/ }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("点击批准一次触发 onApprove(false)", () => {
    const onApprove = vi.fn();
    render(<PermissionCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: /批准一次/ }));
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it("点击批准并本会话记住触发 onApprove(true)", () => {
    const onApprove = vi.fn();
    render(<PermissionCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: /批准并本会话记住/ }));
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  it("按下 Esc 键触发 onDeny", () => {
    const onDeny = vi.fn();
    render(<PermissionCard {...defaultProps} onDeny={onDeny} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("按下 Ctrl+Enter 触发 onApprove(true)", () => {
    const onApprove = vi.fn();
    render(<PermissionCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  it("点击复制按钮调用剪贴板 API", async () => {
    render(<PermissionCard {...defaultProps} />);

    const copyBtn = screen.getByRole("button", { name: "复制命令" });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Get-Content run.ps1");
  });
});
