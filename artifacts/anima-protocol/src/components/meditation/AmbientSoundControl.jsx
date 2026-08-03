import { useState, useRef, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";

const SOUNDSCAPES = [
  { id: "528hz", label: "528Hz Love", freq: 528, color: "#34D399" },
  { id: "432hz", label: "432Hz Healing", freq: 432, color: "#60A5FA" },
  { id: "396hz", label: "396Hz Release", freq: 396, color: "#A78BFA" },
  { id: "741hz", label: "741Hz Clarity", freq: 741, color: "#FBBF24" },
  { id: "rain", label: "Sacred Rain", freq: null, color: "#60A5FA" },
  { id: "bowl", label: "Singing Bowl", freq: null, color: "#C084FC" },
];

// Generate a binaural-like tone using Web Audio API
function createToneNode(ctx, frequency) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 2);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start();
  return { oscillator, gainNode };
}

// Synthesize rain-like noise
function createNoiseNode(ctx) {
  const bufferSize = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;
  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);
  source.start();
  return { source, gainNode };
}

export default function AmbientSoundControl() {
  const [activeSound, setActiveSound] = useState(null);
  const [volume, setVolume] = useState(0.5);
  const [showPanel, setShowPanel] = useState(false);
  const audioCtxRef = useRef(null);
  const activeNodeRef = useRef(null);

  const stopCurrent = () => {
    if (activeNodeRef.current) {
      const node = activeNodeRef.current;
      const gainNode = node.gainNode;
      if (gainNode && audioCtxRef.current) {
        gainNode.gain.linearRampToValueAtTime(0, audioCtxRef.current.currentTime + 1);
        setTimeout(() => {
          try { node.oscillator?.stop(); node.source?.stop(); } catch {}
        }, 1100);
      }
      activeNodeRef.current = null;
    }
  };

  const playSound = (sound) => {
    stopCurrent();
    if (activeSound?.id === sound.id) {
      setActiveSound(null);
      return;
    }
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();

    let node;
    if (sound.freq) {
      node = createToneNode(ctx, sound.freq);
    } else {
      node = createNoiseNode(ctx);
    }
    activeNodeRef.current = node;
    setActiveSound(sound);
  };

  useEffect(() => {
    if (activeNodeRef.current?.gainNode && audioCtxRef.current) {
      activeNodeRef.current.gainNode.gain.setValueAtTime(volume * 0.1, audioCtxRef.current.currentTime);
    }
  }, [volume]);

  useEffect(() => {
    return () => { stopCurrent(); audioCtxRef.current?.close(); };
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(p => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all"
        style={{
          borderColor: activeSound ? "rgba(167,139,250,0.5)" : "rgba(139,92,246,0.2)",
          background: activeSound ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.05)",
          color: activeSound ? "#C084FC" : "rgba(167,139,250,0.5)",
        }}
      >
        {activeSound ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
        {activeSound ? activeSound.label : "Ambient"}
      </button>

      {showPanel && (
        <div className="absolute right-0 top-10 z-50 w-56 border p-3 space-y-3 backdrop-blur-xl"
          style={{ borderColor: "rgba(139,92,246,0.3)", background: "rgba(13,5,32,0.95)" }}>
          <p className="font-mono text-[8px] tracking-[0.3em] uppercase" style={{ color: "rgba(167,139,250,0.5)" }}>
            Sacred Frequencies
          </p>
          <div className="space-y-1.5">
            {SOUNDSCAPES.map(s => (
              <button
                key={s.id}
                onClick={() => playSound(s)}
                className="w-full flex items-center gap-2 px-2.5 py-2 border text-left font-mono text-[9px] transition-all"
                style={{
                  borderColor: activeSound?.id === s.id ? `${s.color}50` : "rgba(255,255,255,0.04)",
                  background: activeSound?.id === s.id ? `${s.color}10` : "transparent",
                  color: activeSound?.id === s.id ? s.color : "rgba(220,210,255,0.5)",
                }}
              >
                <span style={{ color: s.color }}>◉</span>
                {s.label}
                {s.freq && <span className="ml-auto text-[8px]" style={{ color: "rgba(255,255,255,0.2)" }}>{s.freq}Hz</span>}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <p className="font-mono text-[8px] tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.4)" }}>Volume</p>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>
          {activeSound && (
            <button
              onClick={() => { stopCurrent(); setActiveSound(null); }}
              className="w-full font-mono text-[8px] tracking-widest uppercase py-1.5 border transition-all"
              style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,100,100,0.6)" }}
            >
              Stop Sound
            </button>
          )}
        </div>
      )}
    </div>
  );
}