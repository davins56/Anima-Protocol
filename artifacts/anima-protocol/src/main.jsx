// @ts-check
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.full.jsx";
import { initAnalytics } from "./lib/analytics";
import { registerSW } from "virtual:pwa-register";
import "./index.css";

// Initialize Mixpanel once at startup. Tracking stays opted-out until the user
// accepts in ConsentBanner; init itself sends nothing.
initAnalytics();

// Register the auto-updating service worker (no-op in dev, where the plugin
// ships a stub). With registerType "autoUpdate", a new deploy is detected,
// installed, and applied with an automatic reload — no manual cache clear or
// re-adding the home-screen app required.
registerSW({ immediate: true });

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
