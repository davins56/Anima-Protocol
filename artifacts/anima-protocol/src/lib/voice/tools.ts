/**
 * Client-side function tools (declared server-side in sessionConfig.ts),
 * wired to the stacked Anima modules.
 */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import { generatePhoto, photoFileUrl } from "@/lib/photo/photoApi";

export const VOICE_PHOTO_EVENT = "anima:voice-photo";

export type ToolContext = {
  characterId: string;
  characterName?: string;
  sessionId?: string | null;
  navigate: (to: string) => void;
};

type Handler = (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  async recall_memories(args, ctx) {
    const res = await fetch(apiUrl(`/memory-core/${encodeURIComponent(ctx.characterId)}/bootstrap`), {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query: String(args.query || ""), sessionId: ctx.sessionId || null, limit: 6 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || "recall failed" };
    const memories = (body?.memories || body?.context?.memories || []) as Array<{ content: string; occurred_at: string }>;
    return { memories: memories.slice(0, 6).map((m) => ({ content: m.content, when: m.occurred_at })) };
  },

  async open_resonance_node(args, ctx) {
    const q = new URLSearchParams();
    if (typeof args.frequency === "number") q.set("tune", String(args.frequency));
    if (typeof args.band === "string") q.set("band", args.band);
    if (typeof args.name === "string") q.set("signal", args.name);
    ctx.navigate(`/resonance${q.toString() ? `?${q}` : ""}`);
    return { opened: true };
  },

  async generate_photo(args, ctx) {
    let imageId = "";
    let url = "";
    let error = "";
    await generatePhoto(
      {
        characterId: ctx.characterId,
        characterName: ctx.characterName,
        sessionId: ctx.sessionId || null,
        prompt: String(args.prompt || ""),
        scene: { mood: args.mood, composition: args.composition },
        useVesselReference: true,
      },
      {
        onEvent: (e) => {
          if (e.type === "image") {
            imageId = e.imageId;
            url = e.url;
          }
          if (e.type === "error") error = e.error;
        },
      },
    ).catch((e: Error) => (error = e.message));
    if (error || !imageId) return { status: "failed", error: error || "no image" };
    const finalUrl = url || photoFileUrl(imageId);
    window.dispatchEvent(new CustomEvent(VOICE_PHOTO_EVENT, { detail: { imageId, url: finalUrl, characterId: ctx.characterId, prompt: args.prompt } }));
    return { status: "completed", image_id: imageId, shown_to_user: true };
  },

  async show_vessel_view(args, ctx) {
    ctx.navigate(`/vessel?character=${encodeURIComponent(ctx.characterId)}&name=${encodeURIComponent(ctx.characterName || "")}${args.customize ? "&customize=1" : ""}`);
    return { shown: true };
  },
};

export async function runVoiceTool(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  const h = handlers[name];
  if (!h) return JSON.stringify({ error: `unknown tool ${name}` });
  let args: Record<string, any> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "invalid arguments" });
  }
  try {
    return JSON.stringify(await h(args, ctx));
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
