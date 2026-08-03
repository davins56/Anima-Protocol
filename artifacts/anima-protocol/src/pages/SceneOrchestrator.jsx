import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Users, Mic, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CharacterPresenceManager from '@/components/orchestration/CharacterPresenceManager';
import SpeakerSelector from '@/components/orchestration/SpeakerSelector';

export default function SceneOrchestrator() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [scenePresence, setScenePresence] = useState({}); // characterId -> isPresent
  const [nextSpeaker, setNextSpeaker] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  const loadSession = async () => {
    try {
      const sessions = await base44.entities.ChatSession.list('-updated_date', 100);
      const s = sessions.find(x => x.id === sessionId);
      if (!s) {
        navigate('/');
        return;
      }
      
      // Only allow group sessions
      if (s.mode !== 'group') {
        navigate('/');
        return;
      }

      setSession(s);

      // Load characters for this group
      const allChars = await base44.entities.Character.list('-created_date', 500);
      const groupChars = allChars.filter(c => s.group_character_ids?.includes(c.id));
      setCharacters(groupChars);

      // Initialize presence (all present by default)
      const presence = {};
      groupChars.forEach(c => {
        presence[c.id] = true;
      });
      setScenePresence(presence);

      // Set first character as next speaker by default
      if (groupChars.length > 0) {
        setNextSpeaker(groupChars[0].id);
      }
    } catch (err) {
      console.error('Error loading session:', err);
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePresence = (characterId) => {
    setScenePresence(prev => ({
      ...prev,
      [characterId]: !prev[characterId],
    }));
  };

  const handleSpeakerSelect = (characterId) => {
    setNextSpeaker(characterId);
  };

  const handleForceSpeaker = async (characterId) => {
    // Add a system message to the session forcing the next speaker
    const char = characters.find(c => c.id === characterId);
    if (!char) return;

    const systemMsg = {
      role: 'system',
      character_name: 'Orchestrator',
      content: `[ORCHESTRATOR: Next speaker is ${char.name}. They respond now.]`,
      timestamp: new Date().toISOString(),
    };

    const updated = [...(session.messages || []), systemMsg];
    await base44.entities.ChatSession.update(session.id, { messages: updated });
    setSession(prev => ({ ...prev, messages: updated }));
  };

  const presentCharacters = characters.filter(c => scenePresence[c.id]);
  const absentCharacters = characters.filter(c => !scenePresence[c.id]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">Loading orchestrator...</p>
        </div>
      </div>
    );
  }

  if (!session || session.mode !== 'group') {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">Group session not found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/chat/${sessionId}`)}
            className="p-2 text-primary/40 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">Scene Orchestrator</h1>
            <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-1">
              Manage character presence & dialogue flow
            </p>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Character Presence Management */}
          <CharacterPresenceManager
            characters={characters}
            scenePresence={scenePresence}
            presentCharacters={presentCharacters}
            absentCharacters={absentCharacters}
            onTogglePresence={handleTogglePresence}
          />

          {/* Speaker Selection */}
          <SpeakerSelector
            characters={presentCharacters}
            nextSpeaker={nextSpeaker}
            onSelectSpeaker={handleSpeakerSelect}
            onForceSpeaker={handleForceSpeaker}
          />
        </div>

        {/* Scene Status */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 border border-primary/20 bg-black/40 rounded-lg space-y-3"
        >
          <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">Scene Status</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-primary/5 border border-primary/10 rounded">
              <p className="font-mono text-[8px] text-primary/40 uppercase">Total Characters</p>
              <p className="font-mono text-2xl text-primary font-semibold mt-1">{characters.length}</p>
            </div>
            <div className="text-center p-3 bg-green-900/10 border border-green-400/20 rounded">
              <p className="font-mono text-[8px] text-green-400/60 uppercase">Present</p>
              <p className="font-mono text-2xl text-green-400 font-semibold mt-1">{presentCharacters.length}</p>
            </div>
            <div className="text-center p-3 bg-red-900/10 border border-red-400/20 rounded">
              <p className="font-mono text-[8px] text-red-400/60 uppercase">Absent</p>
              <p className="font-mono text-2xl text-red-400 font-semibold mt-1">{absentCharacters.length}</p>
            </div>
          </div>
        </motion.div>

        {/* Latest Messages Preview */}
        {session.messages && session.messages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border border-primary/20 bg-black/40 rounded-lg space-y-3"
          >
            <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">Last Message</h3>
            <div className="p-3 bg-black/60 border border-primary/10 rounded space-y-1">
              <p className="font-mono text-[9px] text-cyan-400 uppercase">
                {session.messages[session.messages.length - 1]?.character_name || 'System'}
              </p>
              <p className="font-mono text-[10px] text-primary/70 leading-relaxed line-clamp-3">
                {session.messages[session.messages.length - 1]?.content || 'No messages yet'}
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}