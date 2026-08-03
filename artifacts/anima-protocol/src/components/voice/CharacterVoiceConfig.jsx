import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, Volume2, Check, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CharacterVoiceConfig({ sessionId }) {
  const [characters, setCharacters] = useState([]);
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [testDialogue, setTestDialogue] = useState("");
  const [testing, setTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [chars, voicesList] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.functions.invoke("elevenLabsVoices", {}),
      ]);
      setCharacters(chars || []);
      setVoices(voicesList?.data?.voices || []);
      if (chars?.length > 0) {
        setSelectedCharacter(chars[0]);
        setSelectedVoice(chars[0].elevenlabs_voice_id || "");
        setTestDialogue(chars[0].speaking_style || "Hello, I am here to help.");
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceAssign = async (characterId, voiceId) => {
    try {
      await base44.entities.Character.update(characterId, {
        elevenlabs_voice_id: voiceId,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      setSelectedVoice(voiceId);
    } catch (err) {
      console.error("Error assigning voice:", err);
    }
  };

  const handleTestVoice = async () => {
    if (!selectedVoice || !testDialogue.trim()) return;
    setTesting(true);
    try {
      await base44.functions.invoke("elevenLabsTTS", {
        text: testDialogue,
        voice_id: selectedVoice,
      });
    } catch (err) {
      console.error("Error playing voice:", err);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Loader className="w-5 h-5 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Loading voice configuration...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Character List */}
      <div className="space-y-3">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-3">
          Characters
        </p>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {characters.map((char) => (
            <motion.button
              key={char.id}
              onClick={() => {
                setSelectedCharacter(char);
                setSelectedVoice(char.elevenlabs_voice_id || "");
                setTestDialogue(char.speaking_style || "");
              }}
              whileHover={{ scale: 1.02 }}
              className={`w-full text-left p-3 border rounded transition-all ${
                selectedCharacter?.id === char.id
                  ? "border-primary/40 bg-primary/10"
                  : "border-primary/15 bg-black/30 hover:border-primary/25"
              }`}
            >
              <div className="flex items-center gap-2">
                {char.avatar_url && (
                  <img
                    src={char.avatar_url}
                    alt={char.name}
                    className="w-8 h-8 rounded border border-primary/20 object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[9px] text-primary/80 tracking-wider uppercase truncate">
                    {char.name}
                  </p>
                  {char.elevenlabs_voice_id && (
                    <p className="text-[8px] font-mono text-green-400/60 flex items-center gap-1 mt-0.5">
                      <Check className="w-2.5 h-2.5" /> Voice assigned
                    </p>
                  )}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Voice Configuration */}
      {selectedCharacter && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="border border-primary/20 bg-black/30 rounded p-4 space-y-4"
        >
          <div>
            <p className="font-mono text-sm text-primary tracking-widest uppercase mb-1">
              {selectedCharacter.name}
            </p>
            <p className="text-[9px] font-mono text-primary/50 mb-3">
              Assign a voice from ElevenLabs
            </p>

            {/* Voice Selection */}
            <div className="space-y-2 mb-4">
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block">
                Available Voices
              </label>
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/80 font-mono text-[9px] min-h-[44px]">
                  <SelectValue placeholder="-- Select Voice --" />
                </SelectTrigger>
                <SelectContent className="bg-background border-primary/30">
                  {voices.map((v) => (
                    <SelectItem key={v.voice_id} value={v.voice_id} className="font-mono text-primary/80">
                      {v.name} ({v.accent})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVoice && (
                <button
                  onClick={() => handleVoiceAssign(selectedCharacter.id, selectedVoice)}
                  className="w-full px-3 py-2 bg-green-900/30 border border-green-400/40 text-green-400 hover:bg-green-900/50 transition-all font-mono text-[9px] tracking-widest uppercase"
                >
                  {saveSuccess ? "✓ Voice Assigned" : "Assign Voice"}
                </button>
              )}
            </div>

            {/* Test Dialogue */}
            <div className="space-y-2">
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block">
                Test Dialogue
              </label>
              <textarea
                value={testDialogue}
                onChange={(e) => setTestDialogue(e.target.value)}
                placeholder="Enter dialogue to preview..."
                rows={4}
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
              />
              <button
                onClick={handleTestVoice}
                disabled={!selectedVoice || !testDialogue.trim() || testing}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 transition-all font-mono text-[9px] tracking-widest uppercase"
              >
                <Volume2 className="w-3 h-3" />
                {testing ? "Playing..." : "Preview Voice"}
              </button>
            </div>

            {/* Info */}
            <div className="p-2 bg-primary/5 border border-primary/10 rounded text-[8px] font-mono text-primary/60 space-y-0.5 mt-3">
              <p className="flex items-start gap-1.5">
                <AlertCircle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                <span>Voices are used for character dialogue in TTS mode.</span>
              </p>
              <p className="ml-4">Ensure voice matches character personality and tone.</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}