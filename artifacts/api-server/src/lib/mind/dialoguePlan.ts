/**
 * Per-turn dialogue plan for the hosted chat mind.
 *
 * Pure and deterministic: it reads the reply history and the character's own
 * written identity, and returns one short note for the closing turn note. No
 * extra model call, no randomness (the "beat" is chosen from a hash of the
 * turn so replays are stable). It shapes pacing, question use, initiative
 * and callbacks; vocabulary and lore still come from the persona prompt, and
 * the temporary mood is stated as tone-only so it cannot overwrite who the
 * character is.
 */

export type DialogueRegister = "casual" | "intimate" | "playful" | "serious" | "reflective" | "roleplay";
export type Temperament = "sharp" | "quiet" | "warm" | "curious" | "neutral";

export type DialoguePlanInput = {
  userText: string;
  recentReplies: string[];
  mode?: string | null;
  character?: { name?: unknown; personality?: unknown; speaking_style?: unknown } | null;
  /** True when a MEMORY block with recalled moments is in this prompt. */
  hasMemory?: boolean;
  hasMood?: boolean;
};

const STOCK_PHRASES: Array<[RegExp, string]> = [
  [/\bi(?:'|’)m (?:always )?here for you\b/i, "I'm here for you"],
  [/\bthat(?:'|’)s (?:completely |totally )?(?:valid|understandable)\b/i, "that's valid"],
  [/\bit(?:'|’)s (?:completely |totally )?okay to feel\b/i, "it's okay to feel"],
  [/\bi (?:completely |totally )?understand\b/i, "I understand"],
  [/\bthat must (?:be|feel|have been)\b/i, "that must be…"],
  [/\bi hear you\b/i, "I hear you"],
  [/\bthank you for (?:sharing|trusting)\b/i, "thank you for sharing"],
  [/\bas an ai\b/i, "as an AI"],
  [/\bhow does that (?:make|feel)\b/i, "how does that make you feel"],
];

export function detectRegister(userText: string, mode?: string | null): DialogueRegister {
  const m = String(mode || "").toLowerCase();
  const t = String(userText || "").toLowerCase();
  if (/(roleplay|role_play|story|rp\b|scene)/.test(m)) return "roleplay";
  if (/^\s*\*|\*[^*]+\*/.test(userText)) return "roleplay";
  if (/(therapy|serious)/.test(m) || /\b(anxious|panic|grief|depress|scared|hurting|can't cope|lost (?:my|someone))\b/.test(t)) return "serious";
  if (/\b(love you|miss you|need you|hold me|tonight|kiss|cuddle)\b/.test(t) || /intimate|adult|romance/.test(m)) return "intimate";
  if (/\b(lol|haha|lmao|joke|kidding|tease|silly)\b/.test(t) || /😂|😏|😜|🤣/.test(userText)) return "playful";
  if (/\b(wonder|meaning|why do (?:i|we)|looking back|thinking about|been thinking|reflect)\b/.test(t)) return "reflective";
  return "casual";
}

export function detectTemperament(character: DialoguePlanInput["character"]): Temperament {
  const text = `${character?.personality ?? ""} ${character?.speaking_style ?? ""}`.toLowerCase();
  if (/(sarcas|dry|wit|blunt|snark|tease|sardonic|acerbic)/.test(text)) return "sharp";
  if (/(quiet|reserved|terse|laconic|stoic|few words|guarded|taciturn|short sentences)/.test(text)) return "quiet";
  if (/(gentle|warm|nurtur|tender|soft-spoken|caring)/.test(text)) return "warm";
  if (/(curious|inquisitive|eager|wonder)/.test(text)) return "curious";
  return "neutral";
}

const words = (s: string) => (String(s || "").trim().match(/\S+/g) || []).length;
const endsWithQuestion = (s: string) => /\?["”')\]*_\s]*$/.test(String(s || "").trim());

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function staleReassurances(replies: string[]): string[] {
  const found: string[] = [];
  for (const [re, label] of STOCK_PHRASES) {
    if (replies.some((r) => re.test(r)) && !found.includes(label)) found.push(label);
  }
  return found.slice(0, 3);
}

function lengthLine(input: DialoguePlanInput, register: DialogueRegister, temperament: Temperament): string {
  const userWords = words(input.userText);
  const lens = input.recentReplies.slice(-3).map(words).filter((n) => n > 0);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const samey = lens.length >= 3 && Math.max(...lens) - Math.min(...lens) <= Math.max(6, avg * 0.25);
  let line: string;
  if (userWords <= 6 && register !== "serious") line = "Match their brevity: a line or two is enough.";
  else if (register === "serious" || register === "reflective") line = "Take the room the moment needs, then stop; no padding.";
  else if (register === "roleplay") line = "Let the scene set the length; keep your beat in character.";
  else line = "Let length follow what they gave you.";
  if (temperament === "quiet") line += " You are economical by nature.";
  if (samey) line += ` Your last replies were all about ${Math.round(avg)} words; break that rhythm${avg > 40 ? " and go shorter" : ""}.`;
  return line;
}

function questionLine(input: DialoguePlanInput): string {
  const recent = input.recentReplies.slice(-3);
  const asked = recent.filter(endsWithQuestion).length;
  const userAsked = /\?/.test(input.userText);
  if (userAsked) return "Answer what they asked first and plainly" + (asked >= 2 ? "; do not end on a question." : ".");
  if (asked >= 2) return "You have ended on a question in most recent replies: end this one on a statement, reaction or observation instead.";
  if (asked === 1) return "A question is optional this time; a statement or observation can carry it.";
  return "";
}

function beatLine(input: DialoguePlanInput, register: DialogueRegister, temperament: Temperament): string {
  const options: string[] = [];
  options.push("react to the specific thing they said before anything else");
  options.push("offer one observation of your own rather than asking about theirs");
  if (temperament === "sharp" || register === "playful") options.push("tease them lightly, in your own way");
  if (temperament !== "warm" && register !== "intimate") {
    options.push("disagree or push back if it truly fits who you are; do not agree by reflex");
  }
  if (temperament === "curious" || register === "reflective") options.push("follow one thread that actually interests you");
  if (temperament === "quiet") options.push("say less than expected and let it land");
  const pick = options[hash(`${input.userText}|${input.recentReplies.length}`) % options.length];
  return `This turn, if it fits you: ${pick}.`;
}

/**
 * The note appended to the closing turn instruction. Returns "" only when
 * there is nothing to say (never, in practice, for a real turn).
 */
export function dialoguePlanNote(input: DialoguePlanInput): string {
  const register = detectRegister(input.userText, input.mode);
  const temperament = detectTemperament(input.character);
  const parts: string[] = [];
  const style = String(input.character?.speaking_style ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (style) parts.push(`Stay in your own voice (${style}): its word choice and rhythm, not a generic helper's.`);
  parts.push(lengthLine(input, register, temperament));
  const q = questionLine(input);
  if (q) parts.push(q);
  parts.push(beatLine(input, register, temperament));
  const stale = staleReassurances(input.recentReplies);
  if (stale.length) parts.push(`Retire these stock lines you have already used: ${stale.map((s) => `"${s}"`).join(", ")}. Comfort in your own way.`);
  if (register === "serious") parts.push("Be steady and specific; no cheerleading, no lecture.");
  if (register === "roleplay") parts.push("Stay inside the scene and its lore; do not step out to explain.");
  if (input.hasMemory) {
    parts.push("Bring up a remembered moment only if it bears on what they just said; otherwise leave it unmentioned. Never invent shared history that is not in your memory.");
  }
  if (input.hasMood) parts.push("Your current mood colors tone for this reply only; who you are and your lore do not change.");
  return parts.join(" ");
}
