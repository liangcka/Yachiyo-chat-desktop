import { expect, type Page } from "@playwright/test";

/** 界面直接进入工作台；发送前等待后台会话建立，避免首次请求与鉴权竞争。 */
export async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "想问什么都可以，@ 引用文件，/ 执行动作" })).toBeEnabled();
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const response = await fetch("/api/session", { credentials: "include" });
      const session: unknown = await response.json();
      return response.ok && typeof session === "object" && session !== null
        && "authenticated" in session && session.authenticated === true;
    });
  }).toBe(true);
}
