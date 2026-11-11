/**
 * Friendly labels for ensemble mind ids. Unknown ids are shown as-is.
 * Restored from a definition that was dropped from Chat.jsx while the call site remained.
 */
const MIND_LABELS = {
  kimi: "Kimi",
  xai: "Grok",
  openai: "ChatGPT",
};

export function mindLabel(id) {
  const key = String(id ?? "");
  return MIND_LABELS[key] || key;
}
