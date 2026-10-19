import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ControlOverlayWindow } from "./features/computer-control/ControlOverlayWindow";
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

const isControlOverlayWindow = typeof window !== "undefined" && window.location.search.includes("window=overlay");

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      {isControlOverlayWindow ? <ControlOverlayWindow /> : <App />}
    </AppErrorBoundary>
  </StrictMode>,
);

