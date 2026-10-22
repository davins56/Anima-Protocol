/**
 * Serenity voice (xAI Grok Voice realtime). The browser never sees XAI_API_KEY:
 *   GET  /api/voice/status                      { enabled, model }
 *   GET  /api/voice/voices                      built-in roster (GET /v1/tts/voices)
 *   GET  /api/voice/:characterId                current voice version
 *   PUT  /api/voice/:characterId                { voice_id, kind?, settings?, consent? } → new version
 *   POST /api/voice/:characterId/clone          { dataUrl, name?, language?, consent: true } → xAI custom voice → new version
 *   POST /api/voice/:characterId/session        ephemeral token + documented session.update payload
 *   POST /api/voice/:characterId/turns          { session_id, turn_id, user_text, assistant_text, interrupted? } → memory_events
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit, rateLimit } from "../lib/rateLimit";
import {
  createClientSecret,
  createCustomVoice,
  getCustomVoice,
  isVoiceAgentEnabled,
  listBuiltinVoices,
  MAX_CLONE_SECONDS,
  voiceModel,
  wavDurationSeconds,
  XAI_REALTIME_URL,
  XaiError,
} from "../lib/voice/xaiVoiceClient";
import { currentVoice, DEFAULT_VOICE_ID, loadCharacterRecord, saveVoice } from "../lib/voice/voiceStore";
import { buildVoiceSession } from "../lib/voice/sessionConfig";
import { appendMemoryEvent } from "../lib/memoryCore/memoryCore";

const router = Router();
router.use(rateLimit);
const tokenLimit = createRateLimit({ windowMs: 60_000, max: 12, name: "voice-token" });
const MAX_CLONE_BYTES = 15 * 1024 * 1024;
const AUDIO_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm", "audio/ogg", "audio/flac", "audio/aac"]);

function uid(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function requireEnabled(res: Response): boolean {
  if (isVoiceAgentEnabled()) return true;
  res.status(503).json({
    error: "Voice agent is not enabled on this server (needs XAI_API_KEY and ANIMA_VOICE_AGENT=xai).",
    code: "voice_disabled",
  });
  return false;
}

function fail(res: Response, err: unknown) {
  if (err instanceof XaiError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  const e = err as { status?: number; code?: string; message?: string };
  if (e?.code === "42P01" || e?.code === "42883") {
    res.status(503).json({ error: "Voice tables are not migrated yet.", code: "voice_schema_missing" });
    return;
  }
  if (e?.code === "23514") {
    res.status(400).json({ error: "Invalid voice data (custom voices require consent).", code: "voice_invalid" });
    return;
  }
  res.status(e?.status && e.status < 600 ? e.status : 500).json({ error: e?.message || "Voice request failed." });
}

router.get("/status", (_req, res) => {
  res.json({ enabled: isVoiceAgentEnabled(), model: voiceModel() });
});

router.get("/voices", async (req, res) => {
  if (!uid(req, res) || !requireEnabled(res)) return;
  try {
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.json({ voices: await listBuiltinVoices() });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/:characterId", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.json({ voice: await currentVoice(userId, String(req.params.characterId)), enabled: isVoiceAgentEnabled() });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/:characterId", async (req, res) => {
  const userId = uid(req, res);
  if (!userId || !requireEnabled(res)) return;
  const b = (req.body || {}) as Record<string, any>;
  const characterId = String(req.params.characterId);
  const voiceId = String(b.voice_id || "").trim().toLowerCase();
  try {
    let kind: "builtin" | "custom" = "builtin";
    let displayName: string | null = null;
    let language: string | null = null;
    const builtin = (await listBuiltinVoices()).find((v) => v.voice_id === voiceId);
    if (builtin) {
      displayName = builtin.name;
      language = builtin.language;
    } else {
      // Console-created custom voice: verify it belongs to our xAI team.
      const custom = /^[a-z0-9]{8}$/.test(voiceId) ? await getCustomVoice(voiceId) : null;
      if (!custom) {
        res.status(400).json({ error: "Unknown voice_id.", code: "voice_unknown" });
        return;
      }
      if (b.consent !== true) {
        res.status(400).json({ error: "Confirm you have the speaker's consent to use this cloned voice.", code: "voice_consent_required" });
        return;
      }
      kind = "custom";
      displayName = custom.name || voiceId;
      language = custom.language || null;
    }
    const character = await loadCharacterRecord(userId, characterId);
    res.status(201).json(
      await saveVoice({
        userId,
        characterId,
        name: String(character?.name || ""),
        voiceId,
        kind,
        displayName,
        language,
        settings: b.settings,
        cloneSource: kind === "custom" ? "console" : null,
        consent: kind === "custom" ? true : false,
        changeNote: typeof b.change_note === "string" ? b.change_note : "",
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/clone", async (req, res) => {
  const userId = uid(req, res);
  if (!userId || !requireEnabled(res)) return;
  const b = (req.body || {}) as Record<string, any>;
  const characterId = String(req.params.characterId);
  if (b.consent !== true) {
    res.status(400).json({ error: "Voice cloning requires the speaker's explicit consent.", code: "voice_consent_required" });
    return;
  }
  const m = typeof b.dataUrl === "string" ? /^data:([^;]+);base64,(.+)$/s.exec(b.dataUrl) : null;
  const contentType = m?.[1]?.toLowerCase() || "";
  if (!m || !AUDIO_TYPES.has(contentType)) {
    res.status(400).json({ error: "Send the reference clip as an audio data URL (wav recommended).", code: "voice_audio_invalid" });
    return;
  }
  if (m[2].length > Math.ceil(MAX_CLONE_BYTES / 3) * 4) {
    res.status(413).json({ error: "Reference audio is too large (max 15 MB).", code: "voice_audio_too_large" });
    return;
  }
  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  const wavSeconds = wavDurationSeconds(bytes);
  const seconds = wavSeconds ?? (typeof b.duration_s === "number" ? b.duration_s : null);
  if (seconds != null && seconds > MAX_CLONE_SECONDS) {
    res.status(400).json({ error: `Reference audio must be ≤ ${MAX_CLONE_SECONDS} s.`, code: "voice_audio_too_long" });
    return;
  }
  try {
    const character = await loadCharacterRecord(userId, characterId);
    const name = String(b.name || character?.name || "Companion voice").slice(0, 80);
    const created = await createCustomVoice({
      bytes,
      contentType,
      filename: contentType.includes("wav") ? "reference.wav" : "reference",
      name,
      language: typeof b.language === "string" ? b.language : undefined,
      gender: typeof b.gender === "string" ? b.gender : undefined,
      tone: typeof b.tone === "string" ? b.tone : undefined,
    });
    res.status(201).json(
      await saveVoice({
        userId,
        characterId,
        name: String(character?.name || ""),
        voiceId: created.voice_id,
        kind: "custom",
        displayName: created.name || name,
        language: created.language || null,
        settings: b.settings,
        cloneSource: "api",
        referenceSeconds: seconds,
        consent: true,
        changeNote: "cloned voice",
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/session", tokenLimit, async (req, res) => {
  const userId = uid(req, res);
  if (!userId || !requireEnabled(res)) return;
  const characterId = String(req.params.characterId);
  try {
    const [character, voice] = await Promise.all([
      loadCharacterRecord(userId, characterId),
      currentVoice(userId, characterId).catch(() => null),
    ]);
    const shareMemory = String(process.env.ANIMA_VOICE_SHARE_MEMORY || "on").toLowerCase() !== "off";
    const [secret, session] = await Promise.all([
      createClientSecret(Number(process.env.ANIMA_VOICE_TOKEN_TTL_S) || 300),
      buildVoiceSession({
        userId,
        characterId,
        character,
        voiceId: voice?.voice_id || DEFAULT_VOICE_ID,
        settings: voice?.settings,
        sessionId: typeof req.body?.session_id === "string" ? req.body.session_id : null,
        shareMemory,
      }),
    ]);
    const model = voiceModel();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      token: secret.value,
      expires_at: secret.expires_at,
      url: `${XAI_REALTIME_URL}?model=${encodeURIComponent(model)}`,
      model,
      session,
      voice_version: voice?.version ?? null,
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/turns", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  const b = (req.body || {}) as Record<string, any>;
  const user = typeof b.user_text === "string" ? b.user_text.trim().slice(0, 2000) : "";
  const assistant = typeof b.assistant_text === "string" ? b.assistant_text.trim().slice(0, 2000) : "";
  const turnId = typeof b.turn_id === "string" ? b.turn_id.slice(0, 120) : "";
  if (!turnId || (!user && !assistant)) {
    res.status(400).json({ error: "turn_id and text are required" });
    return;
  }
  try {
    const id = await appendMemoryEvent({
      userId,
      characterId: String(req.params.characterId),
      conversationId: typeof b.session_id === "string" ? b.session_id : null,
      eventType: "turn",
      content: [user && `User (voice): ${user}`, assistant && `Me (voice)${b.interrupted ? ", interrupted" : ""}: ${assistant}`]
        .filter(Boolean)
        .join("\n"),
      payload: { channel: "voice", interrupted: Boolean(b.interrupted), latency_ms: Number(b.latency_ms) || null },
      emotionalWeight: 0.3,
      dedupeKey: `voice:${turnId}`,
      source: "voice",
    });
    res.status(201).json({ id });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
