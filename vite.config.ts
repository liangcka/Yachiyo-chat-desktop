import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:28888",
        changeOrigin: true,
      },
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.moduleIds.some((id) => id.includes("monaco-editor"))) {
            return "assets/monaco/[name]-[hash].js";
          }
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      strategies: "generateSW",
      includeAssets: [
        "yachiyo-mark.svg",
        "yachiyo-192.png",
        "yachiyo-512.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        name: "Yachiyo Chat",
        short_name: "Yachiyo",
        description: "月见八千代的桌面对话、代码编辑与项目工作区。",
        lang: "zh-CN",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#07102d",
        theme_color: "#142d67",
        icons: [
          {
            src: "/yachiyo-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/yachiyo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/yachiyo-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Monaco 编辑器核心与 80+ 语言包按需动态加载，从 SW 预缓存排除以避免首屏膨胀：
        globIgnores: ["**/*worker*.js", "**/editor.api*.js", "**/monaco/**"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/monaco\/.*\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "monaco-assets-cache",
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
});
