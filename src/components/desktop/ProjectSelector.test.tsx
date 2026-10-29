import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectSelector } from "./ProjectSelector";
import { projectManager } from "../../services/project-manager";
import * as desktopBridge from "../../services/desktop-bridge";

/** 模拟原生层校验成功：返回规范路径（测试中即原路径） */
async function acceptWorkspace(path: string): Promise<desktopBridge.WorkspaceSwitchResult> {
  return { ok: true, path: path.trim() || null };
}

describe("ProjectSelector", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders trigger button with label and chevron icon", () => {
    render(<ProjectSelector label="新建对话" />);
    const trigger = screen.getByRole("button", { name: /新建对话/i });
    expect(trigger).toBeInTheDocument();
    const caret = screen.getByRole("button", { name: /项目选择/i });
    expect(caret).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "项目选择菜单" })).not.toBeInTheDocument();
  });

  it("calls onNewChat directly when clicking main '新建对话' button", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    render(<ProjectSelector label="新建对话" onNewChat={onNewChat} />);

    const mainBtn = screen.getByRole("button", { name: /新建对话/i });
    await user.click(mainBtn);

    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "项目选择菜单" })).not.toBeInTheDocument();
  });

  it("opens dropdown menu on caret click, showing recent projects, 新建项目, 快速开始, and 无项目", async () => {
    const user = userEvent.setup();
    render(<ProjectSelector label="新建对话" />);

    const caret = screen.getByRole("button", { name: /项目选择/i });
    await user.click(caret);

    const menu = screen.getByRole("menu", { name: "项目选择菜单" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "快速开始" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "无项目" })).toBeInTheDocument();
  });

  it("calls pickAndOpenProject and triggers onNewChat when clicking '新建项目'", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    const onSelectProject = vi.fn();

    vi.spyOn(desktopBridge, "pickDesktopFolder").mockResolvedValue("D:\\projects\\demo");
    vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);

    render(
      <ProjectSelector
        label="新建对话"
        onNewChat={onNewChat}
        onSelectProject={onSelectProject}
      />,
    );

    const caret = screen.getByRole("button", { name: /项目选择/i });
    await user.click(caret);

    const newProjectBtn = screen.getByRole("menuitem", { name: "新建项目" });
    await user.click(newProjectBtn);

    expect(desktopBridge.pickDesktopFolder).toHaveBeenCalledWith("Open workspace");
    expect(onSelectProject).toHaveBeenCalledWith("D:\\projects\\demo");
    expect(onNewChat).toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "项目选择菜单" })).not.toBeInTheDocument();
  });

  it("switches to no project when clicking '无项目'", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    const onSelectProject = vi.fn();

    vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);

    render(
      <ProjectSelector
        label="新建对话"
        onNewChat={onNewChat}
        onSelectProject={onSelectProject}
      />,
    );

    const caret = screen.getByRole("button", { name: /项目选择/i });
    await user.click(caret);

    const noProjectBtn = screen.getByRole("menuitem", { name: "无项目" });
    await user.click(noProjectBtn);

    expect(onSelectProject).toHaveBeenCalledWith(null);
    expect(onNewChat).toHaveBeenCalled();
    expect(projectManager.getState().activeProject).toBeNull();
  });

  it("原生切换失败时不新建对话，前端项目保持不变", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);
    await projectManager.switchProject("D:\\projects\\alpha");
    vi.spyOn(desktopBridge, "pickDesktopFolder").mockResolvedValue("D:\\projects\\missing");
    vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue({ ok: false, error: "工作区不可用" });

    render(<ProjectSelector label="新建对话" onNewChat={onNewChat} />);
    await user.click(screen.getByRole("button", { name: /项目选择/i }));
    await user.click(screen.getByRole("menuitem", { name: "新建项目" }));

    expect(onNewChat).not.toHaveBeenCalled();
    expect(projectManager.getState().activeProject).toBe("D:\\projects\\alpha");
  });

  it("closes dropdown on Escape key", async () => {
    const user = userEvent.setup();
    render(<ProjectSelector label="新建对话" />);

    const caret = screen.getByRole("button", { name: /项目选择/i });
    await user.click(caret);
    expect(screen.getByRole("menu", { name: "项目选择菜单" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "项目选择菜单" })).not.toBeInTheDocument();
  });

  it("renders composer variant trigger and opens dropdown with gear and checkmark for active project", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onNewChat = vi.fn();

    await projectManager.switchProject("D:\\web\\Yachiyo-chat-desktop");

    render(
      <ProjectSelector
        variant="composer"
        onOpenSettings={onOpenSettings}
        onNewChat={onNewChat}
      />,
    );

    const trigger = screen.getByTitle(/当前项目：Yachiyo-chat-desktop/i);
    expect(trigger).toBeInTheDocument();


    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "项目选择菜单" })).toBeInTheDocument();

    const gearBtn = screen.getByRole("button", { name: "打开文件与终端" });
    expect(gearBtn).toBeInTheDocument();
    await user.click(gearBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

