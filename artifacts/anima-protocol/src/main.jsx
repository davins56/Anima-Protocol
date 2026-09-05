// @ts-check
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.full.jsx";
import { registerSW } from "virtual:pwa-register";
import "./index.css";

// Mixpanel + Algolia stay off the HTML entry chunk. Consent still gates
// tracking inside analytics.js after this loads.
void import("./lib/analytics").then((mod) => {
  mod.initAnalytics();
});
void import("./lib/algoliaNetlify").then((mod) => {
  mod.initAlgoliaNetlifySearch();
});

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
