/**
 * /api/media — an Anima's own photos and voice notes (switch `media`,
 * ANIMA_KERNEL_MEDIA). See ANIMA_KERNEL.md §14.
 *
 * GET  /capabilities  what this deployment can send (no secrets, no flag names)
 * POST /voice-clip    { characterId, text, cloud_opt_in? } → { url, transcript, … }
 *
 * Voice notes are spoken on the home box (Kokoro). `cloud_opt_in` ("xai" |
 * "elevenlabs") is the steward's explicit opt-in from Settings; without it a
 * down box is a 503 voice_offline with cloudFallback:false.
 *
 * In-chat clips are not capped (the steward asked for them, or the Anima chose
 * to speak in a live conversation); the shared rate limiter still applies.
 * Proactive media is capped in lib/media/outreachMedia.ts.
 */
import { getAuth } from "@clerk/express";
import { Router } from "express";
import { isKernelFeatureEnabled } from "../lib/kernelFeatures";
import { parseCloudOptIn } from "../lib/media/voiceClipCore";
import { synthesizeVoiceClip, voiceClipKeys } from "../lib/media/voiceClip";
import { rateLimit } from "../lib/rateLimit";

const router = Router();
router.use(rateLimit);

router.get("/capabilities", (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const enabled = isKernelFeatureEnabled("media");
  const keys = voiceClipKeys();
  // voice_clip: possible with no opt-in (home box configured). The cloud flags
  // only say an opt-in would work; the client decides with the steward's prefs.
  res.json({
    voice_clip: enabled && keys.local,
    voice_clip_local: enabled && keys.local,
    voice_clip_cloud: { xai: enabled && keys.xai, elevenlabs: enabled && keys.elevenlabs },
    cloud_default: false,
  });
});

router.post("/voice-clip", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isKernelFeatureEnabled("media")) {
    res.status(409).json({ error: "Anima media is switched off" });
    return;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const characterId = typeof body.characterId === "string" ? body.characterId.trim().slice(0, 120) : "";
  const text = typeof body.text === "string" ? body.text.slice(0, 2000) : "";
  if (!characterId || !text.trim()) {
    res.status(400).json({ error: "characterId and text are required" });
    return;
  }
  try {
    const cloudOptIn = parseCloudOptIn(body.cloud_opt_in);
    const clip = await synthesizeVoiceClip({ userId, characterId, text, cloudOptIn });
    res.json({
      url: clip.url,
      content_type: clip.contentType,
      transcript: clip.transcript,
      provider: clip.provider,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string; code?: string; reason?: string; cloudFallback?: boolean };
    const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (e?.code) {
      res.status(status).json({ error: e.message, code: e.code, reason: e.reason, cloudFallback: false });
      return;
    }
    if (status >= 500) console.error("POST /api/media/voice-clip failed:", e?.message);
    res.status(status).json({ error: e?.message || "Voice note failed" });
  }
});

export default router;
