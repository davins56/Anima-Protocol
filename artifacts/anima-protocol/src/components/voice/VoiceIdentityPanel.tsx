/**
 * Pick a built-in xAI voice, link a console-cloned voice_id, or clone from a
 * ≤120 s clip (API cloning is xAI-Enterprise-gated). Each save is a new voice
 * version + identity-core version + `voice_changed` memory event.
 */
import { useEffect, useState } from "react";
import { cloneCharacterVoice, fetchCharacterVoice, fetchVoices, setCharacterVoice, type CharacterVoice } from "@/lib/voice/voiceApi";

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

function audioDuration(f: File): Promise<number | undefined> {
  return new Promise((res) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => res(Number.isFinite(a.duration) ? a.duration : undefined);
    a.onerror = () => res(undefined);
    a.src = URL.createObjectURL(f);
  });
}

export default function VoiceIdentityPanel({ characterId }: { characterId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<CharacterVoice | null>(null);
  const [voices, setVoices] = useState<Array<{ voice_id: string; name: string }>>([]);
  const [customId, setCustomId] = useState("");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!characterId) return;
    fetchCharacterVoice(characterId)
      .then((r) => {
        setEnabled(r.enabled);
        setCurrent(r.voice);
        if (r.enabled) fetchVoices().then((v) => setVoices(v.voices)).catch(() => {});
      })
      .catch(() => setEnabled(false));
  }, [characterId]);

  if (!characterId || enabled === null) return null;
  if (!enabled) return <p className="font-mono text-[11px] text-muted-foreground">Voice agent not enabled on this server.</p>;

  const done = (r: { voice: CharacterVoice; identity_version: number }) => {
    setCurrent(r.voice);
    setMsg(`Voice v${r.voice.version} saved · identity v${r.identity_version}`);
  };
  const fail = (e: Error) => setMsg(e.message);

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] tracking-widest uppercase text-primary/60">
        Voice {current ? `· ${current.display_name || current.voice_id} (v${current.version})` : "· default (eve)"}
      </p>
      <select
        value={current?.voice_kind === "builtin" ? current.voice_id : ""}
        onChange={(e) => e.target.value && setCharacterVoice(characterId, { voice_id: e.target.value }).then(done, fail)}
        className="w-full bg-transparent border border-border px-2 py-2 text-sm"
        aria-label="Built-in voice"
      >
        <option value="">Built-in voice…</option>
        {voices.map((v) => (
          <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
        ))}
      </select>
      <label className="flex items-start gap-2 font-mono text-[11px] text-muted-foreground">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        I own this voice or have the speaker's explicit permission to clone it.
      </label>
      <div className="flex gap-2">
        <input value={customId} onChange={(e) => setCustomId(e.target.value.trim().toLowerCase())} placeholder="Console voice ID (8 chars)" maxLength={8} className="flex-1 bg-transparent border border-border px-2 py-2 text-sm" />
        <button type="button" disabled={!consent || customId.length !== 8} onClick={() => setCharacterVoice(characterId, { voice_id: customId, consent: true }).then(done, fail)} className="border border-border px-3 font-mono text-[11px] disabled:opacity-40">
          Link
        </button>
      </div>
      <label className={`block border border-dashed border-border px-2 py-3 text-center font-mono text-[11px] ${consent ? "cursor-pointer" : "opacity-40"}`}>
        Clone from a clip (≤120 s, WAV best)
        <input
          type="file"
          accept="audio/*"
          disabled={!consent}
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const duration = await audioDuration(f);
            if (duration && duration > 120) return setMsg("Clip must be 120 seconds or shorter.");
            setMsg("Cloning…");
            cloneCharacterVoice(characterId, { dataUrl: await readAsDataUrl(f), consent: true, duration_s: duration }).then(done, fail);
          }}
        />
      </label>
      {msg && <p className="font-mono text-[11px] text-muted-foreground">{msg}</p>}
    </div>
  );
}
