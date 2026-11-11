// The own model, ready to chat: weights + tokenizer + prompt layout +
// streaming generation. Runs in a Web Worker in the app (worker.js) and
// directly in tests.

import { parseInferenceBlob } from "./blob.js";
import { TinyGpt, sampleToken } from "./gpt.js";
import { fitPrompt, promptBudget } from "./prompt.js";
import { ByteLevelBpe } from "./tokenizer.js";

export const DEFAULT_MAX_TOKENS = 128;

export class OwnModelEngine {
  /** @param {ArrayBuffer} buffer an "anima-web-1" inference blob */
  constructor(buffer) {
    const parsed = parseInferenceBlob(buffer);
    this.config = parsed.config;
    this.tokenizer = new ByteLevelBpe(parsed.tokenizer, parsed.special);
    this.model = new TinyGpt(parsed);
    this.stop = new Set([parsed.special.eot, parsed.special.user, parsed.special.anima]);
  }

  promptIds(messages, maxTokens = DEFAULT_MAX_TOKENS) {
    return fitPrompt(this.tokenizer, messages, promptBudget(this.config.block_size, maxTokens));
  }

  /**
   * Stream a reply. Yields text pieces that never split a UTF-8 character;
   * returns { text, tokens, finish }.
   * @param {Array<{ role: string, content: unknown }>} messages
   */
  *generate(messages, { maxTokens = DEFAULT_MAX_TOKENS, temperature = 0.6, topK = 40, random = Math.random } = {}) {
    const prompt = this.promptIds(messages, maxTokens);
    const cache = this.model.newCache();
    let logits = null;
    for (const id of prompt) logits = this.model.step(id, cache);
    const tokens = [];
    let emitted = "";
    let finish = "length";
    const room = this.config.block_size - prompt.length;
    const limit = Math.max(0, Math.min(Math.floor(maxTokens), room));
    for (let i = 0; i < limit; i++) {
      const next = sampleToken(logits, { temperature, topK, random });
      if (this.stop.has(next)) {
        finish = "stop";
        break;
      }
      tokens.push(next);
      const text = this.tokenizer.decode(tokens);
      if (!text.endsWith("�") && text.startsWith(emitted) && text.length > emitted.length) {
        yield text.slice(emitted.length);
        emitted = text;
      }
      if (cache.length >= this.config.block_size) break;
      logits = this.model.step(next, cache);
    }
    const final = this.tokenizer.decode(tokens);
    if (final.startsWith(emitted) && final.length > emitted.length) {
      yield final.slice(emitted.length);
    }
    return { text: final, tokens, finish };
  }

  /** Whole reply at once (tests, previews). */
  reply(messages, options) {
    const it = this.generate(messages, options);
    let step = it.next();
    while (!step.done) step = it.next();
    return step.value;
  }
}
