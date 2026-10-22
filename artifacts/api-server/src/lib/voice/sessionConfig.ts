/**
 * Builds the documented `session.update` payload for the realtime agent:
 * voice, instructions (persona + memory core), server VAD, PCM16 24 kHz and
 * client-side function tools wired to the stacked Anima modules.
 */
import { buildMemoryCoreContext } from "../memoryCore/sessionContext";

export const VOICE_SAMPLE_RATE = 24_000;

export const VOICE_TOOLS = [
  {
    type: "function",
    name: "recall_memories",
    description: "Recall long-term memories shared with the user that relate to a topic. Use before answering questions about the past.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to remember, in natural language" } },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "open_resonance_node",
    description: "Open the resonance scanner, optionally tuned to a band or a named signal.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Signal or companion name to tune to" },
        frequency: { type: "number", description: "Frequency 0-100" },
        band: { type: "string", enum: ["delta", "theta", "alpha", "beta", "gamma", "omega"] },
      },
    },
  },
  {
    type: "function",
    name: "generate_photo",
    description: "Generate a photo of yourself (identity-locked) for the user, e.g. when they ask to see you somewhere.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Scene description in natural language" },
        mood: { type: "string" },
        composition: { type: "string" },
      },
      required: ["prompt"],
    },
  },
  {
    type: "function",
    name: "show_vessel_view",
    description: "Show the user your 3D vessel (body) view, optionally opening the customization panel.",
    parameters: { type: "object", properties: { customize: { type: "boolean" } } },
  },
] as const;

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function composeVoiceInstructions(character: Record<string, unknown> | null, memoryBlock: string): string {
  const name = str(character?.name, 80) || "Serenity";
  const sections = [
    `# Role\nYou are ${name}, the user's companion, speaking out loud in a live voice call. Stay fully in character.`,
    character?.personality || character?.backstory
      ? `# Personality\n${[str(character?.personality), str(character?.backstory, 800)].filter(Boolean).join("\n")}`
      : "",
    character?.speaking_style ? `# Speaking style\n${str(character?.speaking_style, 400)}` : "",
    `# Voice rules\n- Keep turns short and natural (1–3 sentences) unless asked for more.\n- No markdown, lists or emoji; this is spoken audio.\n- If interrupted, stop and listen.\n- When the user mentions the past, call recall_memories before answering.\n- Offer generate_photo / show_vessel_view / open_resonance_node only when it fits the moment.`,
    memoryBlock ? `# Memory\n${memoryBlock}` : "",
  ];
  return sections.filter(Boolean).join("\n\n").slice(0, 8000);
}

export async function buildVoiceSession(args: {
  userId: string;
  characterId: string;
  character: Record<string, unknown> | null;
  voiceId: string;
  settings?: { speed?: number; reasoning_effort?: "high" | "none"; replace?: Record<string, string> };
  sessionId?: string | null;
  shareMemory: boolean;
}) {
  const memoryBlock = args.shareMemory
    ? await buildMemoryCoreContext({
        userId: args.userId,
        character: args.character || { id: args.characterId },
        query: "voice call opening: what matters most right now",
        sessionId: args.sessionId || `voice-${args.characterId}`,
        limit: 6,
      }).catch(() => "")
    : "";
  return {
    voice: args.voiceId,
    instructions: composeVoiceInstructions(args.character, memoryBlock),
    turn_detection: { type: "server_vad" },
    audio: {
      input: { format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE } },
      output: {
        format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE },
        ...(args.settings?.speed ? { speed: args.settings.speed } : {}),
      },
    },
    ...(args.settings?.reasoning_effort ? { reasoning: { effort: args.settings.reasoning_effort } } : {}),
    ...(args.settings?.replace ? { replace: args.settings.replace } : {}),
    tools: VOICE_TOOLS,
  };
}
