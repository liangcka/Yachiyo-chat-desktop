import { expect, test, type Locator, type Page } from "@playwright/test";
import { enterApp } from "./helpers";

async function sendMockMessage(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" }).fill("今天有点累");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText(
    "笑着递上热乎乎的松饼",
  );
}

async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finiteAnimations = document.getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finiteAnimations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function verticalGap(upper: Locator, lower: Locator): Promise<number> {
  const [upperBottom, lowerTop] = await Promise.all([
    upper.evaluate((element) => element.getBoundingClientRect().bottom),
    lower.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  return lowerTop - upperBottom;
}

test("侧栏账户菜单可打开并用 Escape 关闭", async ({ page }) => {
  await enterApp(page);
  const button = page.getByRole("button", { name: /^(用户资料与菜单|用户账户与设置)$/ });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("dialog", { name: "用户账户与设置菜单" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test.describe("基础聊天布局", () => {
  test.use({ serviceWorkers: "block" });

  test("最新回复不被输入区遮挡", async ({ page }) => {
    await enterApp(page);
    await sendMockMessage(page);
    await waitForFiniteAnimations(page);
    expect(await verticalGap(
      page.getByRole("article", { name: "八千代的回复" }).last(),
      page.locator(".desktop-composer-dock"),
    )).toBeGreaterThanOrEqual(0);
  });
});

test("多行输入不遮挡最新回复", async ({ page }) => {
  await enterApp(page);
  await sendMockMessage(page);
  await page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" }).fill("第一行\n第二行\n第三行\n第四行");
  await waitForFiniteAnimations(page);
  expect(await verticalGap(
    page.getByRole("article", { name: "八千代的回复" }).last(),
    page.locator(".desktop-composer-dock"),
  )).toBeGreaterThanOrEqual(0);
});

test("离线状态提示不遮挡最新回复", async ({ context, page }) => {
  await enterApp(page);
  await sendMockMessage(page);
  await context.setOffline(true);
  const statusBanner = page.locator(".status-banner");
  await expect(statusBanner).toBeVisible();
  await waitForFiniteAnimations(page);
  expect(await verticalGap(
    page.getByRole("article", { name: "八千代的回复" }).last(), statusBanner,
  )).toBeGreaterThanOrEqual(0);
  await context.setOffline(false);
});

test("PWA 离线就绪提示不遮挡最新回复", async ({ page }) => {
  await enterApp(page);
  const prompt = page.locator(".pwa-prompt");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await sendMockMessage(page);
  await waitForFiniteAnimations(page);
  expect(await verticalGap(
    page.getByRole("article", { name: "八千代的回复" }).last(), prompt,
  )).toBeGreaterThanOrEqual(0);
});

test("流式回复保持窗口内布局且无控制台错误", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await enterApp(page);
  await sendMockMessage(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const composer = await page.locator(".dsh-composer-card").boundingBox();
  const viewport = page.viewportSize()!;
  expect(composer!.x).toBeGreaterThanOrEqual(0);
  expect(composer!.x + composer!.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("yachiyo-chat.png") });
  expect(consoleErrors).toEqual([]);
});

test("切换日文、提供附件入口，并在离线时禁止发送", async ({ context, page }) => {
  await enterApp(page);
  await page.getByRole("button", { name: /^(用户资料与菜单|用户账户与设置)$/ }).click();
  await page.getByRole("button", { name: "选择语言" }).click();
  const input = page.getByRole("textbox", { name: "何でも聞いてね。@ でファイル参照、/ でアクション" });
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  const attachment = page.locator('input[type="file"]');
  await expect(attachment).toHaveAttribute("multiple", "");
  await expect(attachment).toBeHidden();
  await page.getByRole("button", { name: "ファイル、プロジェクト、スキルを追加" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "ファイルまたは画像を追加" }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([]);
  await context.setOffline(true);
  await expect(page.getByText("オフラインです。端末の履歴は閲覧できます")).toBeVisible();
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "送信", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(input).toBeEnabled();
});
