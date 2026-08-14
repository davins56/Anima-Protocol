import { base44 } from "@/api/base44Client";
import { therapyOpeningMessage } from "./therapyManuals";

/**
 * Start a solo therapy-mode chat with the user's Anima.
 * @param {{ anima: { id: string, name?: string }, userName?: string }} opts
 */
export async function startTherapySession({ anima, userName } = {}) {
  if (!anima?.id) {
    throw new Error("Choose your Anima to begin therapy mode.");
  }

  const name = anima.name || "Anima";
  const opening = {
    role: "assistant",
    character_name: name,
    content: therapyOpeningMessage(name),
    timestamp: new Date().toISOString(),
  };

  const session = await base44.entities.ChatSession.create({
    mode: "solo",
    character_id: anima.id,
    therapy_mode: true,
    companion_mode: "therapy",
    title: `Therapy · ${name}`,
    messages: [opening],
  });

  return session;
}

export function pickDefaultAnima(animas, userEmail) {
  const list = animas || [];
  if (!list.length) return null;
  return list.find((a) => a.assigned_user && a.assigned_user === userEmail) || list[0];
}
