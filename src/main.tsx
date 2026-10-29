import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import "./styles.css";
import { isTauri } from "@tauri-apps/api/core";

if (isTauri() && navigator.platform.startsWith("Mac")) {
  document.documentElement.dataset.platform = "macos";
}

async function renderApp() {
  if (import.meta.env.MODE === "e2e") {
    await import("@wdio/tauri-plugin");
  }

  const App = window.location.hash === "#tray"
    ? (await import("./components/tray-popover")).TrayPopover
    : (await import("./App")).default;

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void renderApp();
