/**
 * V6: split a reply into sentences for one /speak request each (≤ 1000 chars,
 * the server's cap). The server strips tags, stage directions and links; this
 * only drops markdown noise the server might read out literally.
 */
export const SPEAK_MAX_CHARS = 1000;

export function speakableText(raw: string): string {
  return String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(raw: string, max = SPEAK_MAX_CHARS): string[] {
  const text = speakableText(raw);
  if (!text) return [];
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) || [text];
  const out: string[] = [];
  for (const p of parts) {
    let s = p.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(" ", max);
      if (cut < max / 2) cut = max;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
