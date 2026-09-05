import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { updateCompanionRecord } from "@/lib/listPersonalAnimas";
import SpeakToAnimaButton from "@/components/anima/SpeakToAnimaButton";
import VoicePicker from "@/components/voice/VoicePicker";
import VoiceCloneManager from "@/components/characters/VoiceCloneManager";
import { Check, Loader, Mic, Volume2 } from "lucide-react";

/**
 * Voice assignment + test for a personal Anima inside the Customiser hub.
 */
export default function AnimaVoicePanel({ anima, onSave }) {
  const [voiceId, setVoiceId] = useState(anima?.elevenlabs_voice_id || "");
  const [voiceClones, setVoiceClones] = useState(anima?.voice_clones || []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setVoiceId(anima?.elevenlabs_voice_id || "");
    setVoiceClones(anima?.voice_clones || []);
    setSaved(false);
    setError("");
  }, [anima?.id]);

  const persist = async (patch) => {
    if (!anima?.id) return;
    setSaving(true);
    setError("");
    try {
      await updateCompanionRecord(anima, patch);
      if (patch.elevenlabs_voice_id !== undefined) {
        setVoiceId(patch.elevenlabs_voice_id || "");
      }
      if (patch.voice_clones !== undefined) {
        setVoiceClones(patch.voice_clones || []);
      }
      setSaved(true);
      onSave?.(patch);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || "Failed to save voice settings.");
    } finally {
      setSaving(false);
    }
  };

  const onTestVoiceSend = async (userText) => {
    const sysPrompt = `You are ${anima?.name || "Anima"}. ${anima?.personality || ""} ${anima?.speaking_style || ""}. Respond very briefly.`;
    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `User says: "${userText}"`,
      system_prompt: sysPrompt,
      max_tokens: 60,
      response_json_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
      },
    });
    return res?.text || "I have nothing to say.";
  };

  const characterForClone = {
    ...anima,
    elevenlabs_voice_id: voiceId,
    voice_clones: voiceClones,
  };

  return (
    <div className="space-y-4">
      <div className="border border-primary/25 bg-background hud-corner glow-border">
        <div className="px-4 sm:px-5 py-4 border-b border-primary/15 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm text-primary tracking-[0.2em] uppercase">
              // Voice
            </h2>
            <p className="font-mono text-[9px] text-primary/35 tracking-widest uppercase mt-0.5">
              Spoken presence · ElevenLabs + clones
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-[9px] tracking-widest uppercase px-2 py-1 border ${
                voiceId
                  ? "border-green-400/40 bg-green-400/10 text-green-400"
                  : "border-primary/20 bg-black/40 text-primary/40"
              }`}
            >
              {voiceId ? "✓ Voice ready" : "No voice assigned"}
            </span>
            <SpeakToAnimaButton
              activeCharacter={{ ...anima, elevenlabs_voice_id: voiceId }}
              onSend={onTestVoiceSend}
              buttonText="Test Voice"
            />
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              <Volume2 className="w-3 h-3" />
              ElevenLabs Voice
            </label>
            <VoicePicker
              value={voiceId}
              onChange={(v) => {
                setVoiceId(v || "");
                setSaved(false);
              }}
            />
            <button
              type="button"
              onClick={() => persist({ elevenlabs_voice_id: voiceId })}
              disabled={saving || voiceId === (anima?.elevenlabs_voice_id || "")}
              className="mt-3 flex items-center gap-2 px-4 py-2 border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 font-mono text-[10px] tracking-widest uppercase transition-all"
            >
              {saving ? (
                <Loader className="w-3.5 h-3.5 animate-spin" />
              ) : saved ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
              {saving ? "Saving…" : saved ? "Saved" : "Save Voice"}
            </button>
          </div>

          {error && (
            <p className="font-mono text-[10px] text-red-400/90 border border-red-400/30 bg-red-950/20 px-3 py-2">
              {error}
            </p>
          )}

          <p className="font-mono text-[9px] text-primary/30 leading-relaxed">
            Assign a catalog voice or upload a clone below. Speak to Anima uses
            this voice when available; otherwise the system voice is used.
          </p>
        </div>
      </div>

      <div className="border border-primary/20 bg-black/30 p-4 sm:p-5">
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary/40 mb-3">
          Voice clones
        </p>
        <VoiceCloneManager
          character={characterForClone}
          onUpdate={persist}
        />
      </div>
    </div>
  );
}
