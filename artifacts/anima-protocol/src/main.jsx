// @ts-check
import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App.full.jsx";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

// Initialize Mixpanel once at startup. Tracking stays opted-out until the user
// accepts in ConsentBanner; init itself sends nothing.
initAnalytics();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[anima] service worker registration failed", err);
    });
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);
