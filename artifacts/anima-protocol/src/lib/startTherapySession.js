import { base44 } from "@/api/base44Client";
import { therapyOpeningMessage } from "./therapyManuals";
import { normalizeTherapyTopic, therapySessionTitle } from "./therapyTopics";

/**
 * Start a solo therapy-mode chat with the user's Anima.
 * When a topic is provided, the opening and session stay on that subject.
 * @param {{
 *   anima: { id: string, name?: string },
 *   userName?: string,
 *   topic?: string,
 *   topicId?: string,
 *   topicNotes?: string,
 * }} opts
 */
export async function startTherapySession({
  anima,
  userName,
  topic,
  topicId,
  topicNotes,
} = {}) {
  if (!anima?.id) {
    throw new Error("Choose your Anima to begin therapy mode.");
  }

  const name = anima.name || "Anima";
  const { title: topicTitle, notes } = normalizeTherapyTopic({
    title: topic,
    notes: topicNotes,
  });
  const opening = {
    role: "assistant",
    character_name: name,
    content: therapyOpeningMessage(name, topicTitle),
    timestamp: new Date().toISOString(),
  };

  const session = await base44.entities.ChatSession.create({
    mode: "solo",
    character_id: anima.id,
    therapy_mode: true,
    companion_mode: "therapy",
    title: therapySessionTitle({ animaName: name, topicTitle }),
    messages: [opening],
    ...(topicTitle
      ? {
          therapy_topic: topicTitle,
          therapy_topic_notes: notes,
          therapy_topic_id: topicId || null,
        }
      : {}),
  });

  return session;
}

export function pickDefaultAnima(animas, userEmail) {
  const list = animas || [];
  if (!list.length) return null;
  return list.find((a) => a.assigned_user && a.assigned_user === userEmail) || list[0];
}
