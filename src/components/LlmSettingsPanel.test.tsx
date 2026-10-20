import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KEYSTORE_MANAGED_API_KEY } from "../domain/llm";
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

  it("renders an empty state hint when no model is configured", () => {
    mount();
    expect(screen.getByText("模型管理")).toBeInTheDocument();
    expect(screen.getByText(/配置 API key 添加更多可用模型/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加模型" })).toBeInTheDocument();
    expect(screen.getByText(/尚未配置模型/i)).toBeInTheDocument();
  });

  it("renders the management table from stored entries", () => {
    mount({
      entries: [
        { provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash" },
        {
          provider: "openai",
          apiKey: VALID_KEY,
          model: "doubao-pro-32k",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        },
      ],
    });

    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText("doubao-pro-32k")).toBeInTheDocument();
    expect(screen.getByText("自定义端点")).toBeInTheDocument();
    expect(screen.queryByText(/尚未配置模型/i)).not.toBeInTheDocument();
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
    expect(screen.getByText("阿里云百炼")).toBeInTheDocument();
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

    expect(onSave).toHaveBeenCalledWith(
      "openai",
      VALID_KEY,
      "doubao-pro-32k",
      "https://ark.cn-beijing.volces.com/api/v3",
    );
    expect(onActivate).toHaveBeenCalledWith("openai");
  });

  it("does not carry another vendor's model, endpoint or stored key into a shared slot", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({
      onSave,
      entries: [
        {
          provider: "openai",
          apiKey: KEYSTORE_MANAGED_API_KEY,
          model: "kimi-k3",
          baseUrl: "https://api.moonshot.cn/v1",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("阿里云百炼"));

    const dialog = screen.getByRole("dialog", { name: "配置模型" });
    expect(within(dialog).getByDisplayValue("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "保存并启用" });
    expect(save).toBeDisabled();
    await user.type(screen.getByPlaceholderText("请输入服务商 API Key"), VALID_KEY);
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith(
      "openai",
      VALID_KEY,
      "qwen3.8-flash",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
  });

  it("keeps the stored key when reopening the card that owns the slot", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({
      onSave,
      entries: [
        {
          provider: "openai",
          apiKey: KEYSTORE_MANAGED_API_KEY,
          model: "kimi-k3",
          baseUrl: "https://api.moonshot.cn/v1",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("Kimi CN"));
    await user.click(screen.getByRole("button", { name: "保存并启用" }));

    expect(onSave).toHaveBeenCalledWith("openai", KEYSTORE_MANAGED_API_KEY, "kimi-k3", "https://api.moonshot.cn/v1");
  });

  it("asks for the key again when the endpoint of a stored key is changed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({
      onSave,
      entries: [
        {
          provider: "openai",
          apiKey: KEYSTORE_MANAGED_API_KEY,
          model: "kimi-k3",
          baseUrl: "https://api.moonshot.cn/v1",
        },
      ],
    });

    await user.click(screen.getByLabelText("编辑 kimi-k3"));
    const dialog = screen.getByRole("dialog", { name: "配置模型" });
    const save = within(dialog).getByRole("button", { name: "保存并启用" });
    expect(save).toBeEnabled();

    const endpoint = within(dialog).getByDisplayValue("https://api.moonshot.cn/v1");
    await user.clear(endpoint);
    await user.type(endpoint, "https://api.moonshot.ai/v1");
    expect(save).toBeDisabled();
    expect(within(dialog).getByText(/更改端点后请重新输入 API Key/u)).toBeInTheDocument();

    await user.type(within(dialog).getByPlaceholderText("请输入服务商 API Key"), VALID_KEY);
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith("openai", VALID_KEY, "kimi-k3", "https://api.moonshot.ai/v1");
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

    expect(onSave).toHaveBeenCalledWith("openai", VALID_KEY, "ox-alpha", "https://api.openai.com/v1");
    expect(onActivate).toHaveBeenCalledWith("openai");
  });

  it("opens edit config modal from table row", async () => {
    const user = userEvent.setup();
    mount({
      entries: [{ provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash" }],
    });

    const editBtn = screen.getByLabelText("编辑 deepseek-v4-flash");
    await user.click(editBtn);

    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByText("配置 DeepSeek")).toBeInTheDocument();
  });

  it("toggles activate model via switch in table", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn(async () => undefined);
    mount({
      activeProvider: "openai",
      entries: [{ provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash" }],
      onActivate,
    });

    const toggleBtn = screen.getByLabelText("切换启用 deepseek-v4-flash");
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

    const deleteBtn = screen.getByLabelText("删除 step-3.7-flash");
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


