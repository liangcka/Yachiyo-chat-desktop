import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "./EditorView";
import type { EditorWorkspaceController } from "../../app/use-editor-workspace";

vi.mock("./monaco-loader", () => ({
  loadMonaco: vi.fn().mockResolvedValue({
    editor: {
      create: vi.fn().mockReturnValue({
        addCommand: vi.fn(),
        onDidChangeCursorPosition: vi.fn(),
        setModel: vi.fn(),
        updateOptions: vi.fn(),
        dispose: vi.fn(),
      }),
      createModel: vi.fn().mockReturnValue({
        onDidChangeContent: vi.fn(),
        getValue: vi.fn().mockReturnValue(""),
        dispose: vi.fn(),
      }),
      setTheme: vi.fn(),
    },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 },
  }),
  editorThemeFor: vi.fn().mockReturnValue("yachiyo-dark"),
}));

vi.mock("../../services/desktop-bridge", () => ({
  getDesktopWorkspaceRoot: vi.fn().mockResolvedValue("D:/test/my-workspace"),
  setDesktopWorkspaceRoot: vi.fn().mockResolvedValue(true),
  listWorkspaceEntries: vi.fn().mockResolvedValue([
    { name: "index.ts", isDir: false },
    { name: "src", isDir: true },
  ]),
  pickDesktopFolder: vi.fn().mockResolvedValue("D:/test/another-project"),
}));

import { projectManager } from "../../services/project-manager";

describe("EditorView", () => {
  const createMockWorkspace = (override?: Partial<EditorWorkspaceController>): EditorWorkspaceController => ({
    tabs: [],
    activePath: null,
    activeTab: null,
    dirtyCount: 0,
    saving: false,
    openFile: vi.fn().mockResolvedValue(undefined),
    closeTab: vi.fn(),
    resetTabs: vi.fn(),
    setActive: vi.fn(),
    updateContent: vi.fn(),
    saveTab: vi.fn().mockResolvedValue(true),
    isDirty: vi.fn().mockReturnValue(false),
    ...override,
  });

  beforeEach(async () => {
    localStorage.clear();
    await projectManager.switchProject(null);
  });

  it("未选择项目时展示左侧未选择项目与选择项目按钮，右侧显示打开工作区文件夹", async () => {
    const ws = createMockWorkspace();
    render(<EditorView workspace={ws} resolvedTheme="dark" />);

    expect(screen.getByLabelText("工作区文件浏览")).toBeInTheDocument();
    expect(screen.getByText("未选择项目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /选择项目/ })).toBeInTheDocument();
    expect(screen.getByText("工作区代码编辑器")).toBeInTheDocument();
    expect(screen.getByText("打开工作区文件夹")).toBeInTheDocument();
  });

  it("已有文件树时，空状态文案只显示从左侧选择文件打开，不显示打开工作区文件夹按钮", async () => {
    const ws = createMockWorkspace();
    await projectManager.switchProject("D:/test/my-workspace");
    render(<EditorView workspace={ws} resolvedTheme="dark" />);

    expect(await screen.findByText("从左侧选择文件打开")).toBeInTheDocument();
    expect(screen.queryByText("打开工作区文件夹")).not.toBeInTheDocument();
  });

  it("支持折叠侧栏与通过展开按钮还原", () => {
    const ws = createMockWorkspace();
    render(<EditorView workspace={ws} resolvedTheme="dark" />);

    const collapseBtn = screen.getByTitle("折叠文件树侧栏");
    fireEvent.click(collapseBtn);

    expect(screen.queryByLabelText("工作区文件浏览")).not.toBeInTheDocument();

    const expandBtn = screen.getByTitle("展开工作区文件树");
    expect(expandBtn).toBeInTheDocument();

    fireEvent.click(expandBtn);
    expect(screen.getByLabelText("工作区文件浏览")).toBeInTheDocument();
  });

  it("当有打开的 tab 时展示对应 tab 标签并隐藏空状态提示", () => {
    const ws = createMockWorkspace({
      tabs: [
        {
          kind: "file",
          path: "src/index.ts",
          content: "console.log('hello');",
          savedContent: "console.log('hello');",
          readOnly: false,
        },
      ],
      activePath: "src/index.ts",
    });

    render(<EditorView workspace={ws} resolvedTheme="dark" />);

    expect(screen.getByText("index.ts")).toBeInTheDocument();
    expect(screen.queryByText("工作区代码编辑器")).not.toBeInTheDocument();
  });
});
