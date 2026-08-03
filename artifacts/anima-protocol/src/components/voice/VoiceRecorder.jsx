import { useState, useRef } from "react";
import { Mic, Square, Play, Loader } from "lucide-react";

export default function VoiceRecorder({ onRecordingComplete }) {
  const [recording, setRecording] = useState(false);
  const [playback, setPlayback] = useState(false);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        const audioUrl = URL.createObjectURL(audioBlob);
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
        }
        onRecordingComplete(audioBlob, audioUrl);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.start();
      setRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const playRecording = () => {
    if (audioRef.current) {
      setPlayback(true);
      audioRef.current.play();
      audioRef.current.onended = () => setPlayback(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {!recording ? (
          <button
            onClick={startRecording}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-primary/20 bg-black/60 text-primary/60 hover:text-primary/80 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            <Mic className="w-3 h-3" />
            Start Recording
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-900/40 bg-red-900/20 text-red-400 hover:bg-red-900/30 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            <Square className="w-3 h-3" />
            Stop Recording
          </button>
        )}
      </div>
      {audioRef.current?.src && (
        <button
          onClick={playRecording}
          disabled={playback}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-primary/20 bg-black/60 text-primary/60 hover:text-primary/80 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
        >
          {playback ? (
            <>
              <Loader className="w-3 h-3 animate-spin" />
              Playing
            </>
          ) : (
            <>
              <Play className="w-3 h-3" />
              Play Recording
            </>
          )}
        </button>
      )}
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}