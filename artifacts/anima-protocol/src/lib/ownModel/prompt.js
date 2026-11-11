// Prompt layout for the own model — a port of server/modeling.py (keep them
// in step). The model only sees `block_size` tokens, so recent turns are
// kept newest-first and long system prompts only go in when they fit whole.

export const MAX_TEXT_CHARS = 16_000;
export const MIN_PROMPT_TOKENS = 16;

export function messageText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
        }
        return "";
      })
      .join("");
  }
  return String(content);
}

export function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "assistant" || r === "anima") return "anima";
  if (r === "system" || r === "developer") return "system";
  return "user";
}

function tailChars(text, max) {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(-max).join("") : text;
}

export function normalizeMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || typeof m !== "object") continue;
    out.push({ role: normalizeRole(m.role), content: tailChars(messageText(m.content), MAX_TEXT_CHARS) });
  }
  return out;
}

/** Prompt tokens that still leave room for the reply inside the window. */
export function promptBudget(blockSize, maxTokens) {
  const reserve = Math.min(Math.max(Math.floor(maxTokens), 1), Math.floor(blockSize / 2));
  return Math.max(blockSize - reserve, MIN_PROMPT_TOKENS);
}

/**
 * Token ids for `messages`, ending with <|anima|> so the model answers.
 * @param {import("./tokenizer.js").ByteLevelBpe} tokenizer
 */
export function fitPrompt(tokenizer, messages, budget) {
  const { eot, user, anima } = tokenizer.special;
  const turn = (role, textIds) => [role === "anima" ? anima : user, ...textIds, eot];
  const msgs = normalizeMessages(messages);
  let room = Math.max(Math.floor(budget), MIN_PROMPT_TOKENS) - 2;
  const dialogue = msgs.filter((m) => m.role !== "system");
  const system = msgs.filter((m) => m.role === "system");

  const kept = [];
  const newestFirst = dialogue.slice().reverse();
  for (let i = 0; i < newestFirst.length; i++) {
    const m = newestFirst[i];
    const textIds = tokenizer.encodeText(m.content);
    const whole = turn(m.role, textIds);
    if (whole.length <= room) {
      kept.push(whole);
      room -= whole.length;
      continue;
    }
    if (i === 0) {
      const keep = Math.max(room - 2, 0);
      const tail = turn(m.role, keep ? textIds.slice(-keep) : []);
      kept.push(tail);
      room -= tail.length;
    }
    break;
  }

  const systemKept = [];
  for (const m of system.slice().reverse()) {
    const whole = turn("user", tokenizer.encodeText(m.content));
    if (whole.length <= room) {
      systemKept.push(whole);
      room -= whole.length;
    }
  }

  const ids = [eot];
  for (const t of systemKept.reverse()) ids.push(...t);
  for (const t of kept.reverse()) ids.push(...t);
  ids.push(anima);
  return ids;
}
