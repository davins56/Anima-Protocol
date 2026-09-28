// Runs the own model off the main thread so a reply being written never
// freezes the chat. Messages: { type: "load", id, buffer, version } and
// { type: "generate", id, messages, options }; answers "loaded", "delta"
// (the reply so far), "done" and "error".
import { OwnModelEngine } from "./engine.js";

let engine = null;

self.onmessage = (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "load") {
      engine = new OwnModelEngine(msg.buffer);
      self.postMessage({ type: "loaded", id: msg.id, config: engine.config });
      return;
    }
    if (msg.type === "generate") {
      if (!engine) throw new Error("The model is not loaded yet.");
      const it = engine.generate(msg.messages, msg.options || {});
      let text = "";
      let step = it.next();
      while (!step.done) {
        text += step.value;
        self.postMessage({ type: "delta", id: msg.id, text });
        step = it.next();
      }
      self.postMessage({ type: "done", id: msg.id, result: { text: step.value.text, finish: step.value.finish } });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, message: err?.message || String(err) });
  }
};
