import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2 } from "lucide-react";

export default function AudioPlayer({ src, label = "Audio Message" }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateDuration = () => setDuration(audio.duration);
    const updateTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const formatTime = (seconds) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2 p-2 bg-black/40 border border-primary/20 hud-corner w-full">
      <audio ref={audioRef} src={src} className="hidden" />

      <button
        onClick={togglePlayPause}
        className="flex-shrink-0 w-7 h-7 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 flex items-center justify-center transition-all"
      >
        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        <p className="text-[9px] font-mono text-primary/70 tracking-wider uppercase">{label}</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-black/60 border border-primary/10 relative">
            <div
              className="h-full bg-primary/60 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[8px] font-mono text-primary/50 w-10 text-right">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      <Volume2 className="w-3 h-3 text-primary/40 flex-shrink-0" />
    </div>
  );
}