import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { LlmSettingsPanel } from "./LlmSettingsPanel";

const copy = copyFor("zh-CN");
const VALID_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";

function mount(overrides: Partial<Parameters<typeof LlmSettingsPanel>[0]> = {}) {
  const props = {
    copy,
    open: true,
    entries: [] as const,
    onClose: vi.fn(),
    onSave: vi.fn(async () => undefined),
    onClear: vi.fn(async () => undefined),
    onActivate: vi.fn(async () => undefined),
    ...overrides,
  };
  return render(<LlmSettingsPanel {...props} />);
}

describe("LlmSettingsPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = mount({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the default-service hint when no active provider is set", () => {
    mount();
    expect(screen.getByText("未配置，使用默认服务")).toBeInTheDocument();
  });

  it("shows the active provider label when one is active", () => {
    mount({ activeProvider: "claude" });
    expect(screen.getByText("当前使用: Anthropic (Claude)")).toBeInTheDocument();
  });

  it("renders the model management table with models and action controls", () => {
    mount();
    expect(screen.getByText("模型管理")).toBeInTheDocument();
    expect(screen.getByText(/配置 API key 添加更多可用模型/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加模型" })).toBeInTheDocument();
    expect(screen.getByText("DeepSeek-V4-Flash")).toBeInTheDocument();
    expect(screen.getByText("阶跃星辰-3.7-flash")).toBeInTheDocument();
    expect(screen.getByText("ox-alpha")).toBeInTheDocument();
  });

  it("opens add model modal with custom model and provider vendors", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.queryByRole("dialog", { name: "添加模型" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加模型" }));

    expect(screen.getByRole("dialog", { name: "添加模型" })).toBeInTheDocument();
    expect(screen.getByText("自定义模型")).toBeInTheDocument();
    expect(screen.getByText("火山引擎")).toBeInTheDocument();
    expect(screen.getByText("MiniMax CN")).toBeInTheDocument();
    expect(screen.getByText("阿里云")).toBeInTheDocument();
    expect(screen.getByText("硅基流动")).toBeInTheDocument();
  });

  it("opens vendor config modal and saves API key and model", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    const onActivate = vi.fn(async () => undefined);
    mount({ onSave, onActivate });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("火山引擎"));

    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByText("配置 火山引擎")).toBeInTheDocument();

    const keyInput = screen.getByPlaceholderText("请输入服务商 API Key");
    await user.type(keyInput, VALID_KEY);
    await user.click(screen.getByRole("button", { name: "保存并启用" }));

    expect(onSave).toHaveBeenCalledWith("openai", VALID_KEY, "doubao-pro-32k");
    expect(onActivate).toHaveBeenCalledWith("openai");
  });

  it("opens custom model config and saves custom model", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    const onActivate = vi.fn(async () => undefined);
    mount({ onSave, onActivate });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("自定义模型"));

    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByText(/配置自定义模型/i)).toBeInTheDocument();

    const keyInput = screen.getByPlaceholderText("请输入服务商 API Key");
    await user.type(keyInput, VALID_KEY);
    await user.click(screen.getByRole("button", { name: "保存并启用" }));

    expect(onSave).toHaveBeenCalledWith("openai", VALID_KEY, "ox-alpha");
    expect(onActivate).toHaveBeenCalledWith("openai");
  });

  it("opens edit config modal from table row", async () => {
    const user = userEvent.setup();
    mount();

    const editBtn = screen.getByLabelText("编辑 DeepSeek-V4-Flash");
    await user.click(editBtn);

    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByText("配置 DeepSeek")).toBeInTheDocument();
  });

  it("toggles activate model via switch in table", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn(async () => undefined);
    mount({ activeProvider: "openai", onActivate });

    const toggleBtn = screen.getByLabelText("切换启用 DeepSeek-V4-Flash");
    await user.click(toggleBtn);

    expect(onActivate).toHaveBeenCalledWith("deepseek");
  });

  it("calls onClear when deleting a configured model from table", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => undefined);
    mount({
      entries: [{ provider: "stepfun", apiKey: VALID_KEY, model: "step-3.7-flash" }],
      onClear,
    });

    const deleteBtn = screen.getByLabelText("删除 阶跃星辰-3.7-flash");
    await user.click(deleteBtn);

    expect(onClear).toHaveBeenCalledWith("stepfun");
  });

  it("toggles API key visibility in modal", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    const modal = screen.getByRole("dialog", { name: "添加模型" });
    await user.click(within(modal).getByText("DeepSeek"));

    const input = screen.getByPlaceholderText("请输入服务商 API Key") as HTMLInputElement;
    expect(input.type).toBe("password");

    await user.click(screen.getByTitle("显示 API Key"));
    expect(input.type).toBe("text");

    await user.click(screen.getByTitle("隐藏 API Key"));
    expect(input.type).toBe("password");
  });
});


