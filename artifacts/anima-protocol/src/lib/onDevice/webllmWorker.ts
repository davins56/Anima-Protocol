/// <reference lib="webworker" />
// Chat upgrade 3: WebLLM runs in this worker so generation never blocks the UI.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
