import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(({ isMobile }) => isMobile, "验证桌面浏览器布局");

test("工具入口集中在输入区，弹层在窄窗口内可操作", async ({ page }) => {
  await enterApp(page);
  const toolbar = page.getByRole("group", { name: "对话工具栏" });
  await expect(toolbar.getByRole("button", { name: "添加文件、项目或技能" })).toBeVisible();
  await expect(page.locator(".desktop-chat-header .desktop-header-pill")).toHaveCount(0);
  await expect(page.getByText("Enter 发送 · Shift+Enter 换行")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  const input = page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" });
  await input.fill("检查输入状态");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();

  for (const width of [1440, 960, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await toolbar.getByRole("button", { name: "添加文件、项目或技能" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "联网搜索" })).toBeVisible();
    await page.getByRole("button", { name: "加载技能", exact: true }).click();
    const skills = page.getByRole("dialog", { name: "快捷加载技能" });
    await expect(skills).toBeVisible();
    const bounds = await skills.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(skills).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("正文与工具按事件顺序展示，重载后保留顺序并默认折叠", async ({ page }) => {
  const event = (type: string, payload: object): string => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  await page.route("**/api/chat", async (route) => route.fulfill({
    contentType: "text/event-stream; charset=utf-8",
    body: event("delta", { text: "先检查工作区。" })
      + event("thought", { text: "确认需要运行的命令。" })
      + ["one", "two"].map((id) => event("tool_call", { id, name: "run_command", arguments: { command: id } })
        + event("tool_result", { id, name: "run_command", output: "ok", isError: false, durationMs: 10 })).join("")
      + event("delta", { text: "已检查配置。" })
      + event("tool_call", { id: "three", name: "run_command", arguments: { command: "three" } })
      + event("tool_result", { id: "three", name: "run_command", output: "missing", isError: true, durationMs: 10 })
      + event("delta", { text: "最终结果：需要补充配置。（点头）使用 `npm run build` 验证。" })
      + event("done", { truncated: false }),
  }));
  await enterApp(page);
  await page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" }).fill("检查工具顺序");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByRole("article", { name: "八千代的回复" }).last();
  await expect(reply).toContainText("最终结果");
  const process = reply.locator(".message-process");
  await expect(process).not.toHaveAttribute("open");
  await process.locator(":scope > summary").click();
  const orderedContent = async (): Promise<string[]> => process.locator(".message-process__content").evaluate((element) => [...element.children]
    .map((child) => child.matches("details") ? child.querySelector("summary")!.textContent! : child.textContent!));
  const expected = ["先检查工作区。", expect.stringContaining("思考了"), "已运行 2 步", "已检查配置。",
    "已运行 1 步1 步失败"];
  await expect.poll(orderedContent).toEqual(expected);
  await expect(reply.locator(".message-tool-group[open]")).toHaveCount(0);
  await reply.getByText("已运行 2 步", { exact: true }).click();
  await expect(reply.locator(".message-tool-group[open]")).toHaveCount(1);
  await expect(reply.getByText("完成", { exact: true })).toHaveCount(0);
  await expect(reply.locator(".assistant-identity-header")).toHaveCount(0);
  await expect(reply.locator(".yachiyo-emote-badge")).toHaveCSS("font-style", "italic");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await page.reload();
  await expect(process).not.toHaveAttribute("open");
  await expect(reply).toContainText("最终结果：需要补充配置。");
  await process.locator(":scope > summary").click();
  await expect.poll(orderedContent).toEqual(expected);
  await expect(reply.locator(".message-tool-group[open]")).toHaveCount(0);
});


test("命令面板可键盘搜索，编辑消息保留版本且重载后可切换", async ({ page }) => {
  const event = (type: string, payload: object): string => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  await page.route("**/api/chat", async (route) => route.fulfill({ contentType: "text/event-stream", body: event("delta", { text: "已收到问题" }) + event("done", { truncated: false }) }));
  await enterApp(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("联网搜索");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "设置中心" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "联网搜索" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  const input = page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" });
  await input.fill("旧问题"); await input.press("Enter");
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText("已收到问题");
  const user = page.getByRole("article", { name: "我的消息" }).last();
  await user.hover(); await user.getByRole("button", { name: "编辑消息" }).click();
  await user.getByRole("textbox", { name: "编辑消息" }).fill("新问题");
  await user.getByRole("button", { name: "保存并重新生成" }).click();
  await expect(user).toContainText("新问题");
  await expect(user.getByLabel("消息版本")).toContainText("2 / 2");
  await page.reload();
  const restored = page.getByRole("article", { name: "我的消息" }).last();
  await restored.hover();
  await restored.getByRole("button", { name: "上一个版本" }).click();
  await expect(restored).toContainText("旧问题");
  await restored.hover();
  await restored.getByRole("button", { name: "下一个版本" }).click();
  await expect(restored).toContainText("新问题");
});

test("文件附件可在发送前移除，发送内容保留文件名和正文", async ({ page }) => {
  let sentText = "";
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as { messages: Array<{ text: string }> };
    sentText = request.messages.at(-1)?.text ?? "";
    await route.fulfill({ contentType: "text/event-stream", body: 'event: delta\ndata: {"text":"已读取附件"}\n\nevent: done\ndata: {"truncated":false}\n\n' });
  });
  await enterApp(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "说明.md", mimeType: "text/plain", buffer: Buffer.from("项目使用 React") });
  await expect(page.getByRole("button", { name: "说明.md" })).toBeVisible();
  await page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" }).fill("请读附件");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已读取附件", { exact: true })).toBeVisible();
  expect(sentText).toContain("【附件 说明.md】");
  expect(sentText).toContain("项目使用 React");
  await expect(page.getByRole("button", { name: "说明.md" })).toHaveCount(0);
});

test("生成中可以直接发送补充要求，并保留上一轮中断记录", async ({ page }) => {
  let requests = 0;
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as { mode?: string };
    if (request.mode !== "title") requests += 1;
    if (requests === 1) await firstGate;
    await route.fulfill({ contentType: "text/event-stream", body: 'event: delta\ndata: {"text":"按补充要求回答"}\n\nevent: done\ndata: {"truncated":false}\n\n' }).catch(() => undefined);
  });
  await enterApp(page);
  const input = page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" });
  await input.fill("开始任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await input.fill("请简短一点");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  releaseFirst?.();
  await expect(page.getByText("按补充要求回答", { exact: true })).toBeVisible();
  await expect(page.getByText("请简短一点", { exact: true })).toBeVisible();
  expect(requests).toBe(2);
});
