import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // glob 形式才能命中任意层级的构建产物目录（根级字面量 ".wrangler" 匹配不到 proxy-worker/.wrangler）
    ignores: [
      "**/.npm-cache",
      "**/.wrangler",
      "android",
      "coverage",
      "design-preview",
      "dist",
      "functions/runtime-types.d.ts",
      "node_modules",
      "playwright-report",
      "public",
      // 原样内置的上游第三方脚本（余额小鲸鱼），不按本仓库规范改写
      "src/features/whale-widget/upstream",
      "src-tauri/target*/**",
      "src-tauri/target*",
      "test-results",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Cloudflare Workers 运行时全局量（纯 JS 文件，TS 检查不覆盖）
    files: ["proxy-worker/**/*.js"],
    languageOptions: {
      globals: {
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
);
