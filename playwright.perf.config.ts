import { defineConfig } from "@playwright/test";

/**
 * web-perf lane 专用配置：与主 e2e 配置的差异——
 * 只保留桌面单项目、独立报告目录、失败不重试（性能数据要可复现）。
 */
const baseURL = "http://127.0.0.1:8788";

export default defineConfig({
  testDir: "./tests/perf",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  // 与 html reporter 的 playwright-report 目录隔离，避免输出目录冲突警告
  outputDir: "test-results/perf",
  use: {
    baseURL,
    locale: "zh-CN",
    serviceWorkers: "allow",
    trace: "off",
  },
  projects: [
    {
      name: "desktop-1280",
      use: {
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: "npm run dev:mock -- --port 8788",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
});
