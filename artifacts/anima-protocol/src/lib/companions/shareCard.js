/**
 * Identity-only shareable companion card. Built from a whitelist: the name
 * (canonical, so "Aeland"), archetype/universe, a one-line tagline, and
 * vessel colours. Never memories, backstory, chat, intimacy settings,
 * the user's data, or private image URLs. Sharing is a local, user-initiated
 * action (copy / download / the device share sheet); nothing is published.
 */
import { canonicalCompanionName } from "@/lib/personalAnimaRecord";
import { defaultVesselFor, parseVesselConfig } from "@/lib/vessel/vesselConfig";

const MAX_TAGLINE = 120;

function clean(v, max = 60) {
  return String(v ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function firstSentence(text) {
  const t = clean(text, 400);
  if (!t) return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const s = (m ? m[1] : t).trim();
  return s.length > MAX_TAGLINE ? `${s.slice(0, MAX_TAGLINE - 1).trimEnd()}…` : s;
}

/** @returns {{ name: string, archetype: string, universe: string, tagline: string, colors: { aura: string, eyes: string, accent: string }, aura: string }} */
export function companionShareCard(character, vessel) {
  const c = character || {};
  const v = vessel ? parseVesselConfig(vessel) : defaultVesselFor({ name: c.name });
  return {
    name: clean(canonicalCompanionName(clean(c.name, 40) || "Companion"), 40),
    archetype: clean(c.archetype || c.category || c.role, 40),
    universe: clean(c.universe || "Anima", 40),
    tagline: firstSentence(c.tagline || c.short_description || c.personality),
    colors: { aura: v.effects.color, eyes: v.eyes.color, accent: v.outfit.accent },
    aura: v.effects.aura,
  };
}

export function shareCardText(card) {
  return [
    `${card.name}${card.archetype ? ` · ${card.archetype}` : ""}`,
    card.tagline,
    `${card.universe} — Anima Protocol`,
  ]
    .filter(Boolean)
    .join("\n");
}

function xml(s) {
  return String(s).replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]);
}

/** A self-contained 600×340 SVG (no external refs, no scripts). */
export function shareCardSvg(card) {
  const { aura, eyes, accent } = card.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340">
<defs><radialGradient id="g" cx="78%" cy="40%" r="60%"><stop offset="0" stop-color="${xml(aura)}" stop-opacity="0.55"/><stop offset="1" stop-color="#05070c" stop-opacity="1"/></radialGradient></defs>
<rect width="600" height="340" fill="url(#g)"/>
<rect x="12" y="12" width="576" height="316" fill="none" stroke="${xml(accent)}" stroke-opacity="0.6"/>
<circle cx="468" cy="150" r="64" fill="none" stroke="${xml(aura)}" stroke-width="2"/>
<circle cx="448" cy="142" r="5" fill="${xml(eyes)}"/><circle cx="488" cy="142" r="5" fill="${xml(eyes)}"/>
<text x="40" y="110" font-family="monospace" font-size="40" fill="#e6faff" letter-spacing="4">${xml(card.name.toUpperCase())}</text>
<text x="40" y="146" font-family="monospace" font-size="14" fill="${xml(accent)}" letter-spacing="3">${xml((card.archetype || card.universe).toUpperCase())}</text>
<text x="40" y="200" font-family="serif" font-size="16" fill="#cbd5e1">${xml(card.tagline)}</text>
<text x="40" y="300" font-family="monospace" font-size="11" fill="#7dd3fc" letter-spacing="3">${xml(card.universe.toUpperCase())} · ANIMA PROTOCOL</text>
</svg>`;
}
