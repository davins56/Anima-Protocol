import { Router } from "express";
import { rateLimit } from "../lib/rateLimit";

const router = Router();
// Scope the limiter to this router's own paths. This router is mounted without a
// path prefix, so an unscoped `router.use(rateLimit)` would run for every /api
// request passing through (e.g. /api/store/*) and exhaust the shared IP budget.
router.use(["/tts", "/voices"], rateLimit);

const DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

// Per-emotion expressiveness modifiers applied on top of intensity.
const EMOTION_TUNE: Record<string, { stability: number; style: number }> = {
  joyful: { stability: -0.05, style: 0.15 },
  calm: { stability: 0.15, style: -0.05 },
  tender: { stability: 0.1, style: 0.05 },
  loving: { stability: 0.0, style: 0.15 },
  sad: { stability: 0.1, style: 0.1 },
  angry: { stability: -0.2, style: 0.25 },
  afraid: { stability: -0.15, style: 0.2 },
  desperate: { stability: -0.2, style: 0.3 },
  hopeful: { stability: 0.0, style: 0.1 },
  conflicted: { stability: -0.05, style: 0.15 },
  surprised: { stability: -0.1, style: 0.2 },
  neutral: { stability: 0.0, style: 0.0 },
};

function voiceSettings(intensity: number, emotion?: string) {
  const i = Math.max(0, Math.min(10, Number(intensity) || 5));
  const tune = (emotion && EMOTION_TUNE[emotion]) || EMOTION_TUNE.neutral;
  // Higher intensity -> less stable (more dynamic), more style (expressive).
  const stability = Math.max(0.15, Math.min(0.9, 0.55 - i * 0.025 + tune.stability));
  const style = Math.max(0, Math.min(0.85, 0.2 + i * 0.045 + tune.style));
  return {
    stability,
    similarity_boost: 0.78,
    style,
    use_speaker_boost: true,
  };
}

router.get("/tts/status", (_req, res) => {
  res.json({ configured: Boolean(process.env.ELEVENLABS_API_KEY) });
});

router.get("/voices", async (_req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(503).json({ error: "ElevenLabs API key not configured.", voices: [] });
    return;
  }
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
    });
    if (!r.ok) {
      res.status(r.status).json({ error: `voices ${r.status}`, voices: [] });
      return;
    }
    const data: any = await r.json();
    const voices = (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      preview_url: v.preview_url,
    }));
    res.json({ voices });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      voices: [],
    });
  }
});

router.post("/tts", async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(503).json({ error: "ElevenLabs API key not configured." });
    return;
  }
  const { text, voice_id, intensity, emotion } = req.body || {};
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required." });
    return;
  }
  const clean = text.slice(0, 2500);
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id || DEFAULT_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: clean,
          model_id: "eleven_multilingual_v2",
          voice_settings: voiceSettings(intensity, emotion),
        }),
      },
    );
    if (!r.ok) {
      const errText = await r.text();
      res.status(r.status).json({
        error: `ElevenLabs ${r.status}: ${errText.slice(0, 300)}`,
      });
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
