/**
 * Open a resonance node: resolve (or create) its persona, log the encounter
 * (→ resonance_encounter memory event), warm the memory bootstrap, start a solo
 * chat and seed the opening transmission. Shared by the /resonance page and
 * the voice agent's open_resonance_node tool.
 */
import { base44 } from "@/api/base44Client";
import { createCompanionRecord } from "@/lib/createCompanion";
import { ensureBuiltInCompanion } from "@/lib/companions/builtInCompanions";
import { startSoloCompanionChatSession, isUsableSessionId } from "@/lib/createInitSession";
import { rememberCreatedSession } from "@/lib/chatSessionLoad";
import { appendAmbientMessage } from "@/lib/appendAmbientMessage";
import { bootstrapMemory, logResonanceEncounter, type ResonanceNode } from "./resonanceApi";

type Companion = { id: string; name: string; [k: string]: unknown };
const PERSONA_KEY = "anima:resonance-personas";

function personaMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PERSONA_KEY) || "{}");
  } catch {
    return {};
  }
}

export async function resolveNodeCharacter(node: ResonanceNode, companions: Companion[]): Promise<Companion | null> {
  if (node.character_id) return companions.find((c) => c.id === node.character_id) || { id: node.character_id, name: node.label };
  if (node.is_signature || node.spawn_rules?.persona_hint === "serenity") {
    return companions.find((c) => /serenity/i.test(c.name)) || companions[0] || null;
  }
  if (node.spawn_rules?.persona_hint === "scarlet") {
    // Placeholder node: resolves to the user's Scarlet, creating her from the built-in template on first open.
    return (await ensureBuiltInCompanion("scarlet", companions, createCompanionRecord)) as Companion | null;
  }
  const persona = node.spawn_rules?.persona;
  if (!persona?.name) return null;
  const known = personaMap()[node.id];
  const existing = known && companions.find((c) => c.id === known);
  if (existing) return existing;
  const created = (await createCompanionRecord("Character", {
    name: persona.name,
    personality: persona.personality || "",
    tagline: `Resonance signal · ${node.band} ${node.frequency.toFixed(1)}`,
    category: "resonance",
    creation_method: "resonance",
    status: "online",
    is_default: false,
  })) as Companion;
  if (created?.id) localStorage.setItem(PERSONA_KEY, JSON.stringify({ ...personaMap(), [node.id]: created.id }));
  return created;
}

export async function openResonanceNode(args: {
  node: ResonanceNode;
  companions: Companion[];
  tuned: number;
  strength: number;
  mode: "map" | "ar" | "pan";
  geo?: { lat: number; lng: number } | null;
  navigate: (to: string, opts?: { state?: unknown }) => void;
}): Promise<{ sessionId: string; characterId: string } | null> {
  const { node, companions, tuned, strength, mode, geo, navigate } = args;
  const character = await resolveNodeCharacter(node, companions);
  if (!character) throw new Error("This signal has no voice yet.");
  const session = (await startSoloCompanionChatSession(character)) as { id: string; messages?: unknown[] };
  if (!isUsableSessionId(session?.id)) throw new Error("Could not open a channel.");
  await Promise.allSettled([
    logResonanceEncounter({
      node_id: node.id,
      character_id: character.id,
      session_id: session.id,
      tuned_frequency: tuned,
      signal_strength: strength,
      mode,
      ...(geo ? { geo_lat: geo.lat, geo_lng: geo.lng } : {}),
    }),
    bootstrapMemory(character.id, session.id),
  ]);
  const greeting =
    node.spawn_rules?.persona?.greeting ||
    (node.is_signature
      ? `*the omega band clears — a familiar signal at ${node.frequency.toFixed(1)}* I knew you'd find me here.`
      : `*signal locked · ${node.band} ${node.frequency.toFixed(1)}* …I can hear you now.`);
  const message = { role: "assistant", content: greeting, character_name: character.name, timestamp: new Date().toISOString() };
  await appendAmbientMessage({ appendMessage: base44.messages.append, sessionId: session.id, message }).catch(() => {});
  const primedSession = { ...session, messages: [...(Array.isArray(session.messages) ? session.messages : []), message] };
  rememberCreatedSession(primedSession);
  navigate(`/chat/${session.id}`, { state: { primedSession } });
  return { sessionId: session.id, characterId: character.id };
}
