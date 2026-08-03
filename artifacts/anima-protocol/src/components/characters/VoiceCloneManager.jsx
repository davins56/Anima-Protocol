import { useState, useRef } from "react";
import { Upload, Trash2, Play, Loader, Check, Mic } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import VoiceRecorder from "@/components/voice/VoiceRecorder";

import { useConfirm } from "@/lib/ConfirmDialog";

export default function VoiceCloneManager({ character, onUpdate }) {
  const confirm = useConfirm();
  const [voiceClones, setVoiceClones] = useState(character.voice_clones || []);
  const [uploading, setUploading] = useState(null);
  const [testing, setTesting] = useState(null);
  const [newCloneName, setNewCloneName] = useState("");
  const [recordingMode, setRecordingMode] = useState(false);
  const fileInputRef = useRef(null);

  const handleUploadVoice = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !newCloneName.trim()) return;

    setUploading(newCloneName);
    try {
      const uploadRes = await base44.integrations.Core.UploadFile({ file });
      const clone = {
        id: Date.now().toString(),
        name: newCloneName,
        sample_url: uploadRes.file_url,
        created_at: new Date().toISOString(),
        elevenlabs_id: null,
      };

      const updated = [...voiceClones, clone];
      setVoiceClones(updated);
      await onUpdate({ voice_clones: updated });
      setNewCloneName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(null);
    }
  };

  const handleTestVoice = async (clone) => {
    setTesting(clone.id);
    try {
      if (clone.elevenlabs_id) {
        // Test with ElevenLabs API
        const elevenLabsRes = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${clone.elevenlabs_id}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": "YOUR_ELEVENLABS_API_KEY",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: "This is a test of the voice clone.",
              model_id: "eleven_monolingual_v1",
            }),
          }
        );
        const audioData = await elevenLabsRes.arrayBuffer();
        const audio = new Audio(URL.createObjectURL(new Blob([audioData])));
        audio.play();
      } else if (clone.sample_url) {
        // Play uploaded sample
        const audio = new Audio(clone.sample_url);
        audio.play();
      }
    } catch (err) {
      console.error("Test playback failed:", err);
    } finally {
      setTesting(null);
    }
  };

  const handleDeleteClone = async (cloneId) => {
    const ok = await confirm({
      title: "Delete this voice clone?",
      message: "This permanently removes the voice clone and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const updated = voiceClones.filter((c) => c.id !== cloneId);
    setVoiceClones(updated);
    await onUpdate({ voice_clones: updated });
  };

  const handleAssignClone = async (clone) => {
    await onUpdate({
      elevenlabs_voice_id: clone.elevenlabs_id || clone.sample_url,
    });
  };

  const handleRecordingComplete = async (audioBlob, audioUrl) => {
    if (!newCloneName.trim()) return;
    setUploading(newCloneName);
    try {
      const uploadRes = await base44.integrations.Core.UploadFile({ file: audioBlob });
      const clone = {
        id: Date.now().toString(),
        name: newCloneName,
        sample_url: uploadRes.file_url,
        created_at: new Date().toISOString(),
        elevenlabs_id: null,
        is_recorded: true,
      };
      const updated = [...voiceClones, clone];
      setVoiceClones(updated);
      await onUpdate({ voice_clones: updated });
      setNewCloneName("");
      setRecordingMode(false);
    } catch (err) {
      console.error("Recording upload failed:", err);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Voice Input Section */}
      <div className="p-3 sm:p-4 border border-primary/15 bg-black/40">
        <h4 className="font-mono text-xs text-primary/60 tracking-widest uppercase mb-3">
          Add Voice Clone
        </h4>
        <input
          type="text"
          value={newCloneName}
          onChange={(e) => setNewCloneName(e.target.value)}
          placeholder="Voice name (e.g., 'Deep Voice')"
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-primary/40 mb-3"
        />
        
        {/* Mode Toggle */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setRecordingMode(false)}
            className={`flex-1 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all ${
              !recordingMode
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-primary/15 bg-black/60 text-primary/40 hover:text-primary/60"
            }`}
          >
            Upload
          </button>
          <button
            onClick={() => setRecordingMode(true)}
            className={`flex-1 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-1 ${
              recordingMode
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-primary/15 bg-black/60 text-primary/40 hover:text-primary/60"
            }`}
          >
            <Mic className="w-3 h-3" />
            Record
          </button>
        </div>

        {/* Recording or Upload UI */}
        {recordingMode ? (
          <VoiceRecorder 
            onRecordingComplete={handleRecordingComplete}
          />
        ) : (
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleUploadVoice}
              disabled={!newCloneName.trim() || uploading}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!newCloneName.trim() || uploading}
              className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-primary/20 bg-black/60 text-primary/60 hover:text-primary/80 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              {uploading ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Uploading
                </>
              ) : (
                <>
                  <Upload className="w-3 h-3" />
                  Upload Sample
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Voice Clones List */}
      {voiceClones.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            {voiceClones.length} voice clone{voiceClones.length !== 1 ? "s" : ""}
          </p>
          {voiceClones.map((clone) => (
            <motion.div
              key={clone.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-2.5 sm:p-3 border border-primary/20 bg-black/40 group hover:border-primary/40 transition-all"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h5 className="font-mono text-xs sm:text-[10px] tracking-wider uppercase text-primary truncate">
                    {clone.name}
                  </h5>
                  <p className="text-[8px] font-mono text-primary/40 mt-0.5">
                    {clone.elevenlabs_id ? "ElevenLabs Clone" : clone.is_recorded ? "Recorded" : "Sample Upload"}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => handleTestVoice(clone)}
                    disabled={testing === clone.id}
                    className="w-6 h-6 border border-primary/20 text-primary/40 hover:text-primary/70 disabled:opacity-30 flex items-center justify-center transition-colors"
                    title="Test voice"
                  >
                    {testing === clone.id ? (
                      <Loader className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <Play className="w-2.5 h-2.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleAssignClone(clone)}
                    disabled={character.elevenlabs_voice_id === (clone.elevenlabs_id || clone.sample_url)}
                    className={`w-6 h-6 border flex items-center justify-center transition-colors ${
                      character.elevenlabs_voice_id === (clone.elevenlabs_id || clone.sample_url)
                        ? "border-green-400/40 text-green-400 bg-green-400/10"
                        : "border-primary/20 text-primary/40 hover:text-primary/70"
                    }`}
                    title="Assign voice"
                  >
                    <Check className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteClone(clone.id)}
                    className="w-6 h-6 border border-red-900/20 text-red-900/40 hover:text-red-400 flex items-center justify-center transition-colors"
                    title="Delete clone"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Current Assignment */}
      {character.elevenlabs_voice_id && (
        <div className="p-2.5 sm:p-3 border border-green-400/30 bg-green-400/5">
          <p className="font-mono text-[8px] sm:text-[9px] text-green-400/70 tracking-widest uppercase">
            ✓ Voice assigned for TTS narration
          </p>
        </div>
      )}
    </div>
  );
}