import { expect, test, type Locator, type Page } from "@playwright/test";
import { enterApp } from "./helpers";

async function sendMockMessage(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: "什么都可以告诉我" }).fill("今天有点累");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText(
    "笑着递上热乎乎的松饼",
  );
}

type MotionStyle = {
  animationDelay: string;
  animationDuration: string;
  animationName: string;
  transitionDuration: string;
};

async function motionStyle(locator: Locator): Promise<MotionStyle> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDelay: style.animationDelay,
      animationDuration: style.animationDuration,
      animationName: style.animationName,
      transitionDuration: style.transitionDuration,
    };
  });
}

function maximumCssTimeInMilliseconds(value: string): number {
  return Math.max(...value.split(",").map((part) => {
    const time = Number.parseFloat(part);
    return part.trim().endsWith("ms") ? time : time * 1_000;
  }));
}

async function expectEffectiveAnimation(locator: Locator): Promise<void> {
  const motion = await motionStyle(locator);
  expect(motion.animationName).not.toBe("none");
  expect(maximumCssTimeInMilliseconds(motion.animationDuration)).toBeGreaterThan(0);
}

async function transformScale(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
}

test.describe("动效系统", () => {
  test.use({ serviceWorkers: "block" });

  test("欢迎、会话和设置入口具有进入动效", async ({ page }) => {
    await enterApp(page);
    await expectEffectiveAnimation(page.locator(".desktop-hero__intro"));
    await expectEffectiveAnimation(page.locator(".desktop-hero__cards"));
    await sendMockMessage(page);
    await expectEffectiveAnimation(page.locator(".desktop-conversation-region"));

    await page.getByRole("button", { name: /^(用户资料与菜单|用户账户与设置)$/ }).click();
    const menu = page.getByRole("dialog", { name: "用户账户与设置菜单" });
    await expect(menu).toBeVisible();
    await expectEffectiveAnimation(menu);
    await menu.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置中心" });
    await expect(settings).toBeVisible();
    await expectEffectiveAnimation(settings.locator(".settings-modal"));
    await expectEffectiveAnimation(page.locator(".settings-modal-overlay"));
  });

  test("减少动态效果时取消位移动画，保留淡入反馈", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await enterApp(page);
    for (const selector of [".desktop-hero__intro", ".desktop-hero__cards"]) {
      const element = page.locator(selector);
      const motion = await motionStyle(element);
      expect(motion.animationName).toBe("desktop-conversation-enter");
      expect(maximumCssTimeInMilliseconds(motion.animationDelay)).toBe(0);
      await expect(element).toHaveCSS("transform", "none");
    }
    await sendMockMessage(page);
    expect((await motionStyle(page.locator(".desktop-conversation-region"))).animationName)
      .toBe("desktop-conversation-enter");
    const composerMotion = await motionStyle(page.locator(".dsh-composer-card"));
    expect(composerMotion.animationName).toBe("none");
    expect(maximumCssTimeInMilliseconds(composerMotion.transitionDuration)).toBe(0);

    await page.getByRole("button", { name: /^(打开设置|设置)$/ }).click();
    const settings = page.getByRole("dialog", { name: "设置中心" });
    await expect(settings).toBeVisible();
    await expect(settings.locator(".settings-modal")).toHaveCSS("transform", "none");
    await expectEffectiveAnimation(settings.locator(".settings-modal"));
  });

  test("离线提示与快捷命令反馈具有动效", async ({ context, page }) => {
    await enterApp(page);
    await context.setOffline(true);
    const statusBanner = page.locator(".status-banner");
    await expect(statusBanner).toBeVisible();
    await expectEffectiveAnimation(statusBanner);
    await context.setOffline(false);
    const input = page.getByRole("textbox", { name: "什么都可以告诉我" });
    await expect(input).toBeEnabled();
    await input.fill("/agent");
    await expect(page.getByRole("option", { name: /切换 Agent 模式/ })).toBeVisible();
    await input.press("Enter");
    const toast = page.locator(".toast");
    await expect(toast).toContainText("已切换 Agent 模式");
    await expectEffectiveAnimation(toast);
  });

  test("按压反馈与鼠标悬停反馈保持区分", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440", "需要桌面鼠标指针");
    await enterApp(page);
    const button = page.getByRole("button", { name: "添加文件、项目或技能" });
    await button.hover();
    await expect.poll(() => transformScale(button)).toBe(1);
    await page.mouse.down();
    await expect.poll(() => transformScale(button)).toBeLessThan(0.99);
    await page.mouse.up();
    await expect.poll(() => transformScale(button)).toBe(1);
  });
});
