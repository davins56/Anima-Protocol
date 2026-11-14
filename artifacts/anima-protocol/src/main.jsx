// @ts-check
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.full.jsx";
import { registerSW } from "virtual:pwa-register";
import { initServiceWorker } from "./lib/swUpdate";
import "./index.css";
import "./styles/anima-forge.css";
import { applyForge } from "./lib/animaForge";
applyForge();
import "./styles/appearance-studio.css";
import { applyAppearance } from "./lib/appearanceStudio";
import { initializeColorScheme } from "./lib/colorScheme";
applyAppearance();
initializeColorScheme();

// Mixpanel + Algolia stay off the HTML entry chunk. Consent still gates
// tracking inside analytics.js after this loads.
void import("./lib/analytics").then((mod) => {
  mod.initAnalytics();
});
void import("./lib/algoliaNetlify").then((mod) => {
  mod.initAlgoliaNetlifySearch();
});

// Register the service worker (no-op in dev, where the plugin ships a stub).
// registerType "prompt": a new deploy installs in the background and waits;
// UpdateAvailablePrompt offers a Reload, which waits for any streaming reply
// to finish. No more silent reloads mid-reply, and still no manual cache
// clear or re-adding the home-screen app.
initServiceWorker(registerSW);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
