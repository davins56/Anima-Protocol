import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Volume2, Loader, CheckCircle2, Play } from "lucide-react";

export default function VoicePicker({ value, onChange }) {
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewingId, setPreviewingId] = useState(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    if (!open || voices.length > 0) return;
    setLoading(true);
    base44.functions.invoke("elevenLabsVoices", {})
      .then((res) => setVoices(res.data?.voices || []))
      .finally(() => setLoading(false));
  }, [open]);

  const handlePreview = async (voice, e) => {
    e.stopPropagation();
    if (!voice.preview_url) return;
    if (previewingId === voice.voice_id) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); }
    setPreviewingId(voice.voice_id);
    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => setPreviewingId(null);
    audio.play();
  };

  const filtered = voices.filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedVoice = voices.find((v) => v.voice_id === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-black/60 border border-primary/20 text-primary/70 hover:border-primary/50 font-mono text-xs tracking-wider transition-all text-left"
      >
        <Volume2 className="w-3 h-3 text-primary/40 flex-shrink-0" />
        <span className="flex-1 truncate">
          {selectedVoice ? selectedVoice.name : "No voice assigned"}
        </span>
        <span className="text-primary/30 text-[9px] tracking-widest uppercase">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-primary/30 shadow-xl max-h-64 flex flex-col">
          <div className="p-2 border-b border-primary/10">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search voices..."
              className="w-full bg-black/60 border border-primary/15 text-primary/70 placeholder-primary/20 font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-primary/40"
              autoFocus
            />
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-primary/30">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="font-mono text-xs">Loading voices...</span>
              </div>
            ) : (
              <>
                {/* No voice option */}
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-primary/5 ${!value ? "text-primary" : "text-primary/40"}`}
                >
                  {!value && <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />}
                  <span className="font-mono text-xs">No voice (use system TTS)</span>
                </button>

                {filtered.map((voice) => (
                  <div
                    key={voice.voice_id}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-primary/5 ${value === voice.voice_id ? "bg-primary/10 text-primary" : "text-primary/60"}`}
                    onClick={() => { onChange(voice.voice_id); setOpen(false); }}
                  >
                    {value === voice.voice_id && <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs tracking-wider truncate">{voice.name}</p>
                      {voice.category && (
                        <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase">{voice.category}</p>
                      )}
                    </div>
                    {voice.preview_url && (
                      <button
                        type="button"
                        onClick={(e) => handlePreview(voice, e)}
                        className="p-1 text-primary/30 hover:text-primary transition-colors flex-shrink-0"
                        title="Preview voice"
                      >
                        {previewingId === voice.voice_id ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}