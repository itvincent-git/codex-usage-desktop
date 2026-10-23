import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import { QuotaFloatingWindow } from "./components/quota-floating-window";
import "./styles.css";
import { isTauri } from "@tauri-apps/api/core";

const isQuotaWindow = new URLSearchParams(location.search).get("window") === "quota";
if (isQuotaWindow) document.documentElement.dataset.quotaWindow = "true";

if (isTauri() && navigator.platform.startsWith("Mac")) {
  document.documentElement.dataset.platform = "macos";
}

async function renderApp() {
  if (import.meta.env.MODE === "e2e") {
    await import("@wdio/tauri-plugin");
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {isQuotaWindow ? <QuotaFloatingWindow /> : <App />}
    </React.StrictMode>,
  );
}

void renderApp();
