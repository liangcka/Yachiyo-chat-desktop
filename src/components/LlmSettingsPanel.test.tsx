import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KEYSTORE_MANAGED_API_KEY } from "../domain/llm";
import { copyFor } from "../i18n/messages";
import { LlmSettingsPanel } from "./LlmSettingsPanel";

const fetchModelList = vi.hoisted(() => vi.fn<(request: unknown) => Promise<string[]>>());
vi.mock("../services/model-list", () => ({ fetchModelList }));

const copy = copyFor("zh-CN");
const VALID_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";

function mount(overrides: Partial<Parameters<typeof LlmSettingsPanel>[0]> = {}) {
  const props = {
    copy,
    open: true,
    entries: [] as const,
    onClose: vi.fn(),
    onSave: vi.fn(async () => "new-id"),
    onClear: vi.fn(async () => undefined),
    onActivate: vi.fn(async () => undefined),
    onSetEnabled: vi.fn(async () => undefined),
    ...overrides,
  };
  return render(<LlmSettingsPanel {...props} />);
}

const KIMI_ENTRY = {
  id: "openai~kimi0001",
  provider: "openai" as const,
  apiKey: KEYSTORE_MANAGED_API_KEY,
  model: "kimi-k3",
  baseUrl: "https://api.moonshot.cn/v1",
};

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
    mount({
      activeEntryId: "claude",
      entries: [{ id: "claude", provider: "claude", apiKey: VALID_KEY, model: "claude-sonnet-5" }],
    });
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
        { id: "deepseek", provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash" },
        {
          id: "openai~doubao01",
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

  it("lists several configs of one provider as separate rows with their own vendor names", () => {
    mount({
      entries: [
        KIMI_ENTRY,
        {
          id: "openai~qwen0001",
          provider: "openai",
          apiKey: KEYSTORE_MANAGED_API_KEY,
          model: "qwen-max",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
      ],
    });

    expect(screen.getByText("kimi-k3")).toBeInTheDocument();
    expect(screen.getByText("qwen-max")).toBeInTheDocument();
    expect(screen.getByText("Kimi CN")).toBeInTheDocument();
    expect(screen.getByText("阿里云百炼")).toBeInTheDocument();
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

  it("opens vendor config modal and saves a new config, then activates the saved id", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "openai~volc0001");
    const onActivate = vi.fn(async () => undefined);
    mount({ onSave, onActivate });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("火山引擎"));

    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByText("配置 火山引擎")).toBeInTheDocument();

    const keyInput = screen.getByPlaceholderText("请输入服务商 API Key");
    await user.type(keyInput, VALID_KEY);
    await user.click(screen.getByRole("button", { name: "保存并启用" }));

    expect(onSave).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "doubao-seed-2-1-turbo-260628",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    expect(onActivate).toHaveBeenCalledWith("openai~volc0001");
  });

  it("adds another vendor of the same provider as a new config instead of overwriting", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "openai~qwen0001");
    mount({ onSave, entries: [KIMI_ENTRY] });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("阿里云百炼"));

    const dialog = screen.getByRole("dialog", { name: "配置模型" });
    expect(within(dialog).getByDisplayValue("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "保存并启用" });
    expect(save).toBeDisabled();
    await user.type(screen.getByPlaceholderText("请输入服务商 API Key"), VALID_KEY);
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "qwen3.8-flash",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  });

  it("asks for a key when adding the same vendor again, even if one config already exists", async () => {
    const user = userEvent.setup();
    mount({ entries: [KIMI_ENTRY] });

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(within(screen.getByRole("dialog", { name: "添加模型" })).getByText("Kimi CN"));

    expect(screen.getByRole("button", { name: "保存并启用" })).toBeDisabled();
  });

  it("keeps the stored key when editing an existing config", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => KIMI_ENTRY.id);
    const onActivate = vi.fn(async () => undefined);
    mount({ onSave, onActivate, entries: [KIMI_ENTRY] });

    await user.click(screen.getByLabelText("编辑 kimi-k3"));
    await user.click(within(screen.getByRole("dialog", { name: "配置模型" })).getByRole("button", { name: "保存并启用" }));

    expect(onSave).toHaveBeenCalledWith({
      id: KIMI_ENTRY.id,
      provider: "openai",
      apiKey: KEYSTORE_MANAGED_API_KEY,
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.cn/v1",
    });
    expect(onActivate).toHaveBeenCalledWith(KIMI_ENTRY.id);
  });

  it("asks for the key again when the endpoint of a stored key is changed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => KIMI_ENTRY.id);
    mount({ onSave, entries: [KIMI_ENTRY] });

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
    expect(onSave).toHaveBeenCalledWith({
      id: KIMI_ENTRY.id,
      provider: "openai",
      apiKey: VALID_KEY,
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.ai/v1",
    });
  });

  /** 打开「自定义模型」表单 */
  async function openCustomForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByText("自定义模型"));
  }

  /** 弹窗内的提交按钮（与管理页顶部的「添加模型」同名） */
  function submitButton() {
    return within(screen.getByRole("dialog", { name: "配置模型" })).getByRole("button", { name: "添加模型" });
  }

  /** 长文本用粘贴输入：逐字键入在全量并行运行时可能超过默认超时 */
  async function fill(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
    await user.click(screen.getByLabelText(label));
    await user.paste(text);
  }

  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await fill(user, "自定义请求地址", "https://relay.example.com/v1");
    await fill(user, "模型 ID", "my-model");
    await fill(user, "API 密钥", VALID_KEY);
  }

  it("opens the custom model form and saves the basic fields with default format", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "openai~custom01");
    const onActivate = vi.fn(async () => undefined);
    mount({ onSave, onActivate });

    await openCustomForm(user);
    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "自定义模型" })).toBeInTheDocument();
    expect(screen.getByLabelText("API 格式")).toHaveTextContent("OpenAI Chat Completions 格式");
    expect(screen.getByText(/\/chat\/completions 将会被补充/u)).toBeInTheDocument();

    await fillRequired(user);
    await user.type(screen.getByLabelText("模型展示名称"), "我的模型");
    expect(screen.getByText("4/64")).toBeInTheDocument();
    await user.click(submitButton());

    expect(onSave).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "my-model",
      baseUrl: "https://relay.example.com/v1",
      custom: { apiFormat: "chat_completions", displayName: "我的模型", maxToolRounds: 500 },
    });
    expect(onActivate).toHaveBeenCalledWith("openai~custom01");
  });

  it("validates required fields, trailing slash and numeric ranges before saving", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "id");
    mount({ onSave });

    await openCustomForm(user);
    await user.click(submitButton());
    expect(screen.getAllByText("此项为必填项")).toHaveLength(3);

    await fillRequired(user);
    await user.type(screen.getByLabelText("自定义请求地址"), "/");
    expect(screen.getByText("请求地址不要以斜杠结尾")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "完整 URL" }));
    expect(screen.queryByText("请求地址不要以斜杠结尾")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /高级配置/u }));
    await user.type(screen.getByLabelText("Temperature"), "3");
    expect(screen.getByText("请输入 0 ~ 2 之间的数值")).toBeInTheDocument();
    await user.click(submitButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the API format, full URL switch and advanced settings", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "id");
    mount({ onSave });

    await openCustomForm(user);
    await user.click(screen.getByLabelText("API 格式"));
    await user.click(screen.getByRole("option", { name: "Anthropic Messages 格式" }));
    expect(screen.getByText(/\/messages 将会被补充/u)).toBeInTheDocument();
    await fillRequired(user);
    await user.click(screen.getByRole("switch", { name: "完整 URL" }));

    await user.click(screen.getByRole("button", { name: /高级配置/u }));
    await user.click(screen.getByLabelText("模型系列"));
    await user.click(screen.getByRole("option", { name: "Claude（Anthropic）" }));
    await user.click(screen.getByRole("button", { name: "输入 填入 256k" }));
    await user.click(screen.getByRole("button", { name: "输出 填入 32k" }));
    await user.clear(screen.getByLabelText("工具调用轮数"));
    await user.type(screen.getByLabelText("工具调用轮数"), "80");
    await user.click(screen.getByLabelText("不支持"));
    await user.click(screen.getByLabelText("关闭"));
    await user.type(screen.getByLabelText("Temperature"), "0.6");
    await user.type(screen.getByLabelText("Top P"), "0.9");
    await user.type(screen.getByLabelText("Top K"), "40");
    await user.click(submitButton());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        custom: {
          apiFormat: "anthropic_messages",
          fullUrl: true,
          family: "claude",
          contextWindow: 262_144,
          maxOutputTokens: 32_768,
          maxToolRounds: 80,
          supportsImage: false,
          thinking: "off",
          temperature: 0.6,
          topP: 0.9,
          topK: 40,
        },
      }),
    );
  });

  it("runs the connectivity test before saving and keeps the form open when it fails", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "id");
    const onTestConnection = vi
      .fn<(draft: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error("PROVIDER_STREAM_ERROR"))
      .mockResolvedValueOnce(undefined);
    mount({ onSave, onTestConnection });

    await openCustomForm(user);
    await fillRequired(user);
    await user.click(submitButton());

    expect(onTestConnection).toHaveBeenCalledWith(expect.objectContaining({ model: "my-model" }));
    expect(await screen.findByText("连通性测试失败：PROVIDER_STREAM_ERROR")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    await user.click(submitButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("resets the form to its initial values", async () => {
    const user = userEvent.setup();
    mount();

    await openCustomForm(user);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByLabelText("模型 ID")).toHaveValue("");
    expect(screen.getByLabelText("自定义请求地址")).toHaveValue("");
  });

  it("fetches the endpoint model list in the custom form and picks a model from it", async () => {
    const user = userEvent.setup();
    fetchModelList.mockResolvedValueOnce(["gpt-4o", "qwen-turbo"]);
    mount();

    await openCustomForm(user);
    const fetchButton = screen.getByRole("button", { name: "获取模型列表" });
    expect(fetchButton).toBeDisabled();

    await fill(user, "自定义请求地址", "https://api.openai.com/v1");
    await fill(user, "API 密钥", VALID_KEY);
    await user.click(fetchButton);

    expect(fetchModelList).toHaveBeenCalledWith({ baseUrl: "https://api.openai.com/v1", apiKey: VALID_KEY });
    expect(screen.getByText("端点提供 2 个模型:")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "qwen-turbo" }));
    expect(screen.getByLabelText("模型 ID")).toHaveValue("qwen-turbo");
  });

  it("shows a hint when the model list cannot be fetched", async () => {
    const user = userEvent.setup();
    fetchModelList.mockRejectedValueOnce(new Error("Failed to list models (401)"));
    mount();

    await openCustomForm(user);
    await fill(user, "自定义请求地址", "https://api.openai.com/v1");
    await fill(user, "API 密钥", VALID_KEY);
    await user.click(screen.getByRole("button", { name: "获取模型列表" }));

    expect(screen.getByRole("alert")).toHaveTextContent("获取模型列表失败");
  });

  it("edits a legacy custom-endpoint config as a Chat Completions custom model with its stored key", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => "openai~custom01");
    fetchModelList.mockResolvedValueOnce(["my-model"]);
    mount({
      onSave,
      entries: [
        {
          id: "openai~custom01",
          provider: "openai",
          apiKey: KEYSTORE_MANAGED_API_KEY,
          model: "my-model",
          baseUrl: "https://llm.example.com/v1",
        },
      ],
    });

    await user.click(screen.getByLabelText("编辑 my-model"));
    expect(screen.getByRole("heading", { name: "编辑自定义模型" })).toBeInTheDocument();
    expect(screen.getByLabelText("模型 ID")).toHaveValue("my-model");
    expect(screen.getByLabelText("API 格式")).toHaveTextContent("OpenAI Chat Completions 格式");

    await user.click(screen.getByRole("button", { name: "获取模型列表" }));
    expect(fetchModelList).toHaveBeenCalledWith({ baseUrl: "https://llm.example.com/v1", slot: "openai~custom01" });

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "openai~custom01", apiKey: KEYSTORE_MANAGED_API_KEY }),
    );
  });

  it("shows the display name of a custom model in the table", () => {
    mount({
      entries: [
        {
          id: "openai~custom02",
          provider: "openai",
          apiKey: VALID_KEY,
          model: "relay-model-v2",
          baseUrl: "https://relay.example.com/v1",
          custom: { apiFormat: "responses", displayName: "中转模型" },
        },
      ],
    });

    expect(screen.getByText("中转模型")).toBeInTheDocument();
    expect(screen.queryByText("relay-model-v2")).not.toBeInTheDocument();
  });

  it("opens edit config modal from table row", async () => {
    const user = userEvent.setup();
    mount({
      entries: [{ id: "deepseek", provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash" }],
    });

    const editBtn = screen.getByLabelText("编辑 deepseek-v4-flash");
    await user.click(editBtn);

    expect(screen.getByRole("dialog", { name: "配置模型" })).toBeInTheDocument();
    expect(screen.getByText("配置 DeepSeek")).toBeInTheDocument();
  });

  it("enables several models at once via the table switches", async () => {
    const user = userEvent.setup();
    const onSetEnabled = vi.fn(async () => undefined);
    const onActivate = vi.fn(async () => undefined);
    mount({
      activeEntryId: "openai",
      entries: [
        { id: "openai", provider: "openai", apiKey: VALID_KEY, model: "gpt-5" },
        { id: "deepseek", provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash", disabled: true },
      ],
      onSetEnabled,
      onActivate,
    });

    expect(screen.getByLabelText("切换启用 gpt-5")).toHaveAttribute("aria-checked", "true");
    const deepseekSwitch = screen.getByLabelText("切换启用 deepseek-v4-flash");
    expect(deepseekSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("当前使用")).toBeInTheDocument();

    await user.click(deepseekSwitch);
    expect(onSetEnabled).toHaveBeenCalledWith("deepseek", true);
    expect(onActivate).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText("切换启用 gpt-5"));
    expect(onSetEnabled).toHaveBeenCalledWith("openai", false);
  });

  it("calls onClear with the config id when deleting a configured model from table", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => undefined);
    mount({
      entries: [{ id: "stepfun~a1b2c3d4", provider: "stepfun", apiKey: VALID_KEY, model: "step-3.7-flash" }],
      onClear,
    });

    const deleteBtn = screen.getByLabelText("删除 step-3.7-flash");
    await user.click(deleteBtn);

    expect(onClear).toHaveBeenCalledWith("stepfun~a1b2c3d4");
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
