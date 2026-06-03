// @ts-check
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.full.jsx";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

// Initialize Mixpanel once at startup. Tracking stays opted-out until the user
// accepts in ConsentBanner; init itself sends nothing.
initAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);