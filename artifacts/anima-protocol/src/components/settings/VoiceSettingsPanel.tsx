/**
 * V6 (VITE_ANIMA_LOCAL_VOICE): voice settings.
 * 1. Her home voice: read replies aloud automatically (off by default).
 * 2. A Kokoro voice per companion, with a warning when two companions would
 *    sound the same, and a one-tap distinct suggestion.
 * 3. Cloud voices: each an explicit opt-in, all off by default. Turning one on
 *    never makes it an automatic fallback for the home voice in chat.
 */
import { useEffect, useMemo, useState } from "react";
import { animaClient } from "@/api/animaClient";
import { fetchLocalVoices } from "@/lib/voice/localVoiceApi";
import {
  getLocalVoicePrefs,
  setLocalVoicePrefs,
  sharedVoices,
  suggestDistinctVoice,
  KOKORO_VOICE_RE,
} from "@/lib/voice/localVoicePrefs";
import { getVoicePrefs, setVoicePrefs } from "@/lib/voicePrefs";

interface Companion {
  id: string;
  name: string;
  kokoro_voice_id?: string | null;
}

const CLOUD_OPTIONS: { key: "elevenlabs" | "xai" | "webSpeech" | "nativeSpeech"; label: string; note: string }[] = [
  { key: "elevenlabs", label: "ElevenLabs", note: "Sends reply text to ElevenLabs." },
  { key: "xai", label: "xAI voice notes", note: "Sends voice-note text to xAI." },
  { key: "webSpeech", label: "Browser speech", note: "Some browsers send text to their vendor." },
  { key: "nativeSpeech", label: "iOS speech (app)", note: "Apple's built-in voice in the iOS app." },
];

function Toggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={`relative w-10 h-5 shrink-0 border transition-all ${on ? "border-cyan-400/60 bg-cyan-400/10" : "border-primary/20 bg-black/30"}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 transition-all ${on ? "left-5 bg-cyan-300" : "left-0.5 bg-primary/20"}`} />
    </button>
  );
}

export default function VoiceSettingsPanel() {
  const [autoSpeak, setAutoSpeak] = useState(() => getLocalVoicePrefs().autoSpeak);
  const [cloud, setCloud] = useState(() => getVoicePrefs());
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [voices, setVoices] = useState<string[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await fetchLocalVoices();
      if (!live) return;
      if (Array.isArray(list)) setVoices(list);
      else setVoicesError(list.message);
    })();
    void (async () => {
      try {
        const rows = (await animaClient.entities.Character.list("-created_date", 200)) as Companion[];
        if (live) setCompanions((rows || []).filter((c) => c && c.id && c.name));
      } catch {
        if (live) setCompanions([]);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const shared = useMemo(() => sharedVoices(companions), [companions]);

  const saveVoice = async (id: string, voiceId: string) => {
    if (!KOKORO_VOICE_RE.test(voiceId)) return;
    setSaving(id);
    try {
      await animaClient.entities.Character.update(id, { kokoro_voice_id: voiceId });
      setCompanions((prev) => prev.map((c) => (c.id === id ? { ...c, kokoro_voice_id: voiceId } : c)));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="border border-primary/15 bg-card p-5 space-y-4" data-testid="voice-settings-panel">
      <div className="space-y-2">
        <p className="font-mono text-xs text-primary/80 tracking-wider uppercase">Her home voice</p>
        <p className="text-[11px] text-primary/50">
          Spoken by your home voice server. When it&apos;s down, chat stays text only and says so.
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-primary/70">Read each new reply aloud</span>
          <Toggle
            on={autoSpeak}
            label="Read each new reply aloud"
            testId="voice-auto-speak"
            onChange={(v) => setAutoSpeak(setLocalVoicePrefs({ autoSpeak: v }).autoSpeak)}
          />
        </div>
      </div>

      <div className="space-y-2 border-t border-primary/10 pt-3">
        <p className="font-mono text-xs text-primary/80 tracking-wider uppercase">Voice per companion</p>
        {voicesError && <p className="text-[11px] text-amber-200/80">{voicesError}</p>}
        {companions.length === 0 && <p className="text-[11px] text-primary/40">No companions yet.</p>}
        {companions.map((c) => {
          const current = c.kokoro_voice_id && KOKORO_VOICE_RE.test(c.kokoro_voice_id) ? c.kokoro_voice_id : "";
          const same = shared[c.id] || [];
          const suggestion = voices && same.length ? suggestDistinctVoice(c.id, companions, voices) : null;
          return (
            <div key={c.id} className="space-y-1" data-testid="companion-voice-row">
              <label className="flex items-center justify-between gap-3 text-[12px] text-primary/70">
                <span className="truncate">{c.name}</span>
                <select
                  className="bg-black/40 border border-primary/20 text-primary/80 text-xs p-1.5 min-w-[9rem]"
                  value={current}
                  disabled={!voices || saving === c.id}
                  onChange={(e) => void saveVoice(c.id, e.target.value)}
                  aria-label={`Voice for ${c.name}`}
                >
                  <option value="" disabled>
                    {current ? current : "Default (af_heart)"}
                  </option>
                  {(voices || []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {same.length > 0 && (
                <p className="text-[11px] text-amber-200/80" data-testid="companion-voice-shared">
                  Sounds the same as {same.join(", ")}.
                  {suggestion && (
                    <button
                      type="button"
                      className="ml-1 underline"
                      onClick={() => void saveVoice(c.id, suggestion)}
                      disabled={saving === c.id}
                    >
                      Use {suggestion}
                    </button>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-primary/10 pt-3">
        <p className="font-mono text-xs text-primary/80 tracking-wider uppercase">Cloud voices (opt-in)</p>
        <p className="text-[11px] text-primary/50">
          Off unless you turn them on. They are never used automatically when your home voice is offline.
        </p>
        {CLOUD_OPTIONS.map((o) => (
          <div key={o.key} className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-primary/70">
              {o.label}
              <span className="block text-[10px] text-primary/40">{o.note}</span>
            </span>
            <Toggle
              on={cloud[o.key] === true}
              label={o.label}
              testId={`voice-cloud-${o.key}`}
              onChange={(v) => setCloud(setVoicePrefs({ [o.key]: v }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
