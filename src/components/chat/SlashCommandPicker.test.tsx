import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlashCommandPicker, type SlashActionItem } from "./SlashCommandPicker";
import type { SkillDefinition } from "../../skills";

const mockSkills: SkillDefinition[] = [
  {
    id: "web-search",
    name: "联网检索",
    description: "多渠道容灾检索外部实时动态",
    content: "Search prompt",
  },
  {
    id: "code-review",
    name: "代码审查",
    description: "审查项目代码规范与实现质量",
    content: "Review prompt",
  },
];

const mockActions: SlashActionItem[] = [
  {
    id: "action:agent",
    type: "action",
    name: "切换 Agent 模式",
    command: "/agent",
    description: "在自动、常开与关闭之间循环切换",
    icon: "bot",
    onExecute: vi.fn(),
  },
  {
    id: "action:clear",
    type: "action",
    name: "新建对话",
    command: "/clear",
    description: "重置当前工作台并开启新对话",
    icon: "plus",
    onExecute: vi.fn(),
  },
];

describe("SlashCommandPicker", () => {
  it("renders command items and skills correctly", () => {
    render(
      <SlashCommandPicker
        query=""
        skills={mockSkills}
        activeSkillIds={["web-search"]}
        actions={mockActions}
        onSelect={vi.fn()}
        onToggleSkill={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox", { name: "快捷指令与技能选择" })).toBeInTheDocument();
    expect(screen.getByText("切换 Agent 模式")).toBeInTheDocument();
    expect(screen.getByText("/agent")).toBeInTheDocument();
    expect(screen.getByText("联网检索")).toBeInTheDocument();
    expect(screen.getByText("已加载")).toBeInTheDocument();
    expect(screen.getByText("未加载")).toBeInTheDocument();
  });

  it("filters items according to query", () => {
    render(
      <SlashCommandPicker
        query="审查"
        skills={mockSkills}
        activeSkillIds={[]}
        actions={mockActions}
        onSelect={vi.fn()}
        onToggleSkill={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: /代码审查/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /切换 Agent 模式/i })).not.toBeInTheDocument();
  });

  it("triggers onSelect and onToggleSkill when clicking an item", async () => {
    const user = userEvent.setup();
    const handleSelect = vi.fn();
    const handleToggle = vi.fn();

    render(
      <SlashCommandPicker
        query=""
        skills={mockSkills}
        activeSkillIds={[]}
        actions={mockActions}
        onSelect={handleSelect}
        onToggleSkill={handleToggle}
        onClose={vi.fn()}
      />,
    );

    const skillItem = screen.getByText("联网检索");
    await user.click(skillItem);

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "skill",
        name: "联网检索",
      }),
    );
  });

  it("closes when clicking close button", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <SlashCommandPicker
        query=""
        skills={mockSkills}
        activeSkillIds={[]}
        actions={mockActions}
        onSelect={vi.fn()}
        onToggleSkill={vi.fn()}
        onClose={handleClose}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "关闭快捷指令浮层" });
    await user.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
