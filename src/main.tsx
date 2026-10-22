import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ControlOverlayWindow } from "./features/computer-control/ControlOverlayWindow";
import { isDesktopApp } from "./services/app-platform";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Yachiyo Chat root element is missing.");
}

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}

// 桌面端屏蔽 WebView 自带的右键菜单（刷新/检查等）；输入区与选中文字仍保留系统的复制粘贴菜单
if (isDesktopApp()) {
  document.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    const editable =
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, [contenteditable='true']") !== null);
    const hasSelection = (window.getSelection()?.toString() ?? "").length > 0;
    if (!editable && !hasSelection) event.preventDefault();
  });
}

const isControlOverlayWindow =typeof window !== "undefined" && window.location.search.includes("window=overlay");

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      {isControlOverlayWindow ? <ControlOverlayWindow /> : <App />}
    </AppErrorBoundary>
  </StrictMode>,
);

