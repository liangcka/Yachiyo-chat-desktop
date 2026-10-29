import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileReferencePicker } from "./FileReferencePicker";

const projectMock = vi.hoisted(() => ({
  pickAndOpenProject: vi.fn(),
}));

vi.mock("../../services/project-manager", () => ({
  projectManager: { pickAndOpenProject: projectMock.pickAndOpenProject },
}));

describe("FileReferencePicker", () => {
  beforeEach(() => {
    projectMock.pickAndOpenProject.mockReset();
  });

  const sampleItems = [
    "src/App.tsx",
    "src/components/Composer.tsx",
    "src/components/editor/EditorView.tsx",
    "package.json",
    "README.md",
  ];

  it("正确渲染文件列表与提示信息", () => {
    render(
      <FileReferencePicker
        query=""
        items={sampleItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        workspace="D:/demo"
      />,
    );

    expect(screen.getByText("引用工作区文件")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("根据 query 进行模糊过滤并高亮", () => {
    render(
      <FileReferencePicker
        query="editor"
        items={sampleItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        workspace="D:/demo"
      />,
    );

    const option = document.querySelector('[data-filepath="src/components/editor/EditorView.tsx"]');
    expect(option).toBeInTheDocument();
    expect(option?.textContent).toContain("EditorView.tsx");
    expect(screen.queryByText("package.json")).not.toBeInTheDocument();
  });

  it("点击某一项触发 onSelect 回调并传递完整相对路径", () => {
    const handleSelect = vi.fn();
    render(
      <FileReferencePicker
        query=""
        items={sampleItems}
        onSelect={handleSelect}
        onClose={vi.fn()}
        workspace="D:/demo"
      />,
    );

    const targetItem = screen.getByText("Composer.tsx");
    fireEvent.click(targetItem);

    expect(handleSelect).toHaveBeenCalledWith("src/components/Composer.tsx");
  });

  it("无匹配文件时展示空状态提示", () => {
    render(
      <FileReferencePicker
        query="nonexistent_file_xyz"
        items={sampleItems}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        workspace="D:/demo"
      />,
    );

    expect(screen.getByText("未找到匹配的工作区文件")).toBeInTheDocument();
  });

  it("没有选择项目时说明原因并提供选择项目入口", () => {
    render(
      <FileReferencePicker
        query=""
        items={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        workspace={null}
      />,
    );

    expect(screen.getByText("当前没有选择项目，@ 只能引用项目文件夹里的文件。")).toBeInTheDocument();
    expect(screen.queryByText("未找到匹配的工作区文件")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择项目文件夹" }));
    expect(projectMock.pickAndOpenProject).toHaveBeenCalledTimes(1);
  });

  it("未绑定项目的任务由调用方决定选择项目后的绑定方式", () => {
    const onSelectProject = vi.fn();
    render(
      <FileReferencePicker
        query=""
        items={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        workspace={null}
        onSelectProject={onSelectProject}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择项目文件夹" }));
    expect(onSelectProject).toHaveBeenCalledTimes(1);
    expect(projectMock.pickAndOpenProject).not.toHaveBeenCalled();
  });
});
