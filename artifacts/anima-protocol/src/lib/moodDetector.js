// @ts-check
/**
 * Lightweight client-side mood detector.
 * Analyzes AI response text and maps it to a predefined mood.
 */

export const MOODS = {
  happy:    { label: "Happy",    color: "text-yellow-400",  dot: "bg-yellow-400",  glow: "shadow-yellow-400/40",  emoji: "◉" },
  playful:  { label: "Playful",  color: "text-pink-400",    dot: "bg-pink-400",    glow: "shadow-pink-400/40",    emoji: "◉" },
  romantic: { label: "Romantic", color: "text-rose-400",    dot: "bg-rose-400",    glow: "shadow-rose-400/40",    emoji: "◉" },
  anxious:  { label: "Anxious",  color: "text-amber-400",   dot: "bg-amber-400",   glow: "shadow-amber-400/40",   emoji: "◉" },
  sad:      { label: "Sad",      color: "text-blue-400",    dot: "bg-blue-400",    glow: "shadow-blue-400/40",    emoji: "◉" },
  hostile:  { label: "Hostile",  color: "text-red-500",     dot: "bg-red-500",     glow: "shadow-red-500/40",     emoji: "◉" },
  fearful:  { label: "Fearful",  color: "text-orange-400",  dot: "bg-orange-400",  glow: "shadow-orange-400/40",  emoji: "◉" },
  curious:  { label: "Curious",  color: "text-cyan-400",    dot: "bg-cyan-400",    glow: "shadow-cyan-400/40",    emoji: "◉" },
  cold:     { label: "Cold",     color: "text-slate-400",   dot: "bg-slate-400",   glow: "shadow-slate-400/40",   emoji: "◉" },
  neutral:  { label: "Neutral",  color: "text-primary/60",  dot: "bg-primary/60",  glow: "",                      emoji: "◉" },
};

// Keyword patterns per mood (order matters — first match wins)
const MOOD_PATTERNS = [
  { mood: "hostile",  words: /\b(rage|fury|hatred|kill|attack|threaten|scowl|snarl|growl|despise|loathe|hostile|wrathful|furious|vengeful)\b/i },
  { mood: "fearful",  words: /\b(tremble|shiver|terror|horrified|dread|flee|cower|scream|panic|nightmare|afraid|trembling|whimper)\b/i },
  { mood: "anxious",  words: /\b(anxious|nervous|worry|uneasy|tense|fidget|dread|apprehensive|restless|hesitant|uncertain|wary)\b/i },
  { mood: "sad",      words: /\b(sob|weep|tears|grief|sorrow|heartbreak|mourn|despair|longing|melancholy|ache|miss|lonely|hollow)\b/i },
  { mood: "romantic", words: /\b(love|desire|kiss|tender|longing|caress|embrace|passion|adore|intimate|heart|warmth|beloved|cherish)\b/i },
  { mood: "playful",  words: /\b(laugh|grin|tease|playful|joke|smirk|wink|giggle|mischief|banter|cheeky|spark|wit)\b/i },
  { mood: "happy",    words: /\b(happy|joy|smile|delight|excited|elated|bright|cheer|warm|wonderful|gleam|glee|wonderful|pleased)\b/i },
  { mood: "curious",  words: /\b(curious|wonder|fascinated|intrigued|ponder|question|discover|explore|study|examine|interest|why|how)\b/i },
  { mood: "cold",     words: /\b(silence|distant|blank|expressionless|detached|flat|hollow|void|empty|indifferent|unmoved|stone)\b/i },
];

/**
 * Detects mood from a text string.
 * Also checks for explicit [EMOTION: ...] tags injected by the AI.
 * @param {string} text
 * @returns {string} mood key
 */
export function detectMood(text) {
  if (!text) return "neutral";

  // 1. Check for explicit [EMOTION: ...] tag first
  const emotionTag = text.match(/\[EMOTION:\s*([^\]]+)\]/i);
  if (emotionTag) {
    const raw = emotionTag[1].toLowerCase().trim();
    // Map common emotion phrases to our mood keys
    if (/rage|fury|hostile|angry|anger|wrathful/.test(raw)) return "hostile";
    if (/fear|terror|horrified|dread|cower/.test(raw)) return "fearful";
    if (/anxious|nervous|tense|worry|apprehensive/.test(raw)) return "anxious";
    if (/sad|grief|sorrow|tears|mourn|despair|heartbreak/.test(raw)) return "sad";
    if (/love|romantic|desire|tender|passion/.test(raw)) return "romantic";
    if (/playful|tease|mischief|laugh|giggle/.test(raw)) return "playful";
    if (/happy|joy|smile|excited|elated|cheer/.test(raw)) return "happy";
    if (/curious|wonder|fascinated|intrigued/.test(raw)) return "curious";
    if (/cold|distant|detached|indifferent/.test(raw)) return "cold";
  }

  // 2. Keyword scan
  for (const { mood, words } of MOOD_PATTERNS) {
    if (words.test(text)) return mood;
  }

  return "neutral";
}