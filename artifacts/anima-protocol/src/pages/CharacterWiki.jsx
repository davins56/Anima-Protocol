import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { BookOpen, Heart, Lock, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CharacterWiki() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState({});
  const [memories, setMemories] = useState({});
  const [selectedChar, setSelectedChar] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [sess, rels, mems] = await Promise.all([
          base44.entities.ChatSession.list('-updated_date', 50).then(s => s.find(x => x.id === sessionId)),
          base44.entities.CharacterRelationship.filter({ session_id: sessionId }),
          base44.entities.VectorMemory.filter({ session_id: sessionId }),
        ]);

        setSession(sess);

        // Load characters for this session
        const charIds = sess?.mode === 'solo' 
          ? [sess.character_id]
          : sess?.group_character_ids || [];

        const chars = await base44.entities.Character.list('-created_date', 500);
        const sessionChars = chars.filter(c => charIds.includes(c.id));
        setCharacters(sessionChars);

        // Index relationships by character
        const relMap = {};
        (rels || []).forEach(rel => {
          if (!relMap[rel.character_a_id]) relMap[rel.character_a_id] = [];
          relMap[rel.character_a_id].push(rel);
        });
        setRelationships(relMap);

        // Index memories by character
        const memMap = {};
        (mems || []).forEach(mem => {
          if (!memMap[mem.character_id]) memMap[mem.character_id] = [];
          memMap[mem.character_id].push(mem);
        });
        setMemories(memMap);

        if (sessionChars.length > 0) {
          setSelectedChar(sessionChars[0]);
        }
      } catch (err) {
        console.error('Error loading character wiki:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="font-mono text-primary/50 tracking-widest uppercase text-sm">Loading wiki...</p>
      </div>
    );
  }

  const charRelationships = selectedChar ? relationships[selectedChar.id] || [] : [];
  const charMemories = selectedChar ? memories[selectedChar.id] || [] : [];
  const secrets = charMemories.filter(m => m.memory_type === 'revelation' || m.memory_type === 'emotional_moment');
  const traits = charMemories.filter(m => m.memory_type === 'character_interaction' || m.memory_type === 'growth');

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="w-6 h-6 text-primary/60" />
            <h1 className="text-3xl font-mono text-primary glow-text tracking-[0.2em] uppercase">
              Character Wiki
            </h1>
          </div>
          <p className="text-sm font-mono text-primary/40 tracking-widest uppercase">
            {session?.title || 'Session'} — Relationships • Secrets • Traits
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Character List */}
          <div className="lg:col-span-1">
            <div className="border border-primary/20 bg-black/60 rounded p-4 space-y-2 sticky top-8">
              <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-4">
                Characters
              </p>
              {characters.map(char => (
                <button
                  key={char.id}
                  onClick={() => setSelectedChar(char)}
                  className={`w-full text-left p-3 rounded border transition-all ${
                    selectedChar?.id === char.id
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40 hover:text-primary/80'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {char.avatar_url && (
                      <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-mono uppercase truncate">{char.name}</p>
                      {char.universe && (
                        <p className="text-[8px] font-mono text-primary/30 truncate">{char.universe}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Character Details */}
          {selectedChar && (
            <div className="lg:col-span-3 space-y-6">
              {/* Character Header */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={selectedChar.id}
                className="border border-primary/20 bg-black/60 rounded p-6"
              >
                <div className="flex gap-6 items-start">
                  {selectedChar.avatar_url && (
                    <img
                      src={selectedChar.avatar_url}
                      alt={selectedChar.name}
                      className="w-24 h-24 rounded border border-primary/30 object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <h2 className="text-2xl font-mono text-primary tracking-wider uppercase mb-2">
                      {selectedChar.name}
                    </h2>
                    {selectedChar.universe && (
                      <p className="text-sm font-mono text-primary/50 mb-3">{selectedChar.universe}</p>
                    )}
                    {selectedChar.personality && (
                      <p className="text-sm font-mono text-primary/70 leading-relaxed">
                        {selectedChar.personality}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>

              {/* Relationships */}
              {charRelationships.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="border border-cyan-400/20 bg-cyan-900/10 rounded p-6"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Heart className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-lg font-mono text-cyan-400 tracking-wider uppercase">
                      Relationships
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {charRelationships.map(rel => (
                      <div key={rel.id} className="p-3 bg-black/40 border border-cyan-400/20 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-mono text-sm text-cyan-300 uppercase">
                            {rel.character_b_name}
                          </p>
                          <p className={`text-xs font-mono px-2 py-1 rounded ${
                            rel.score > 50 ? 'bg-green-400/20 text-green-300' :
                            rel.score > 0 ? 'bg-blue-400/20 text-blue-300' :
                            'bg-red-400/20 text-red-300'
                          }`}>
                            {rel.tier}
                          </p>
                        </div>
                        <div className="w-full bg-black/60 h-1 rounded overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              rel.score > 50 ? 'bg-green-400' :
                              rel.score > 0 ? 'bg-blue-400' :
                              'bg-red-400'
                            }`}
                            style={{ width: `${Math.max(5, (rel.score + 100) / 2)}%` }}
                          />
                        </div>
                        {rel.recurring_themes?.length > 0 && (
                          <p className="text-[9px] font-mono text-primary/40 mt-2">
                            {rel.recurring_themes.slice(0, 2).join(' • ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Secrets & Revelations */}
              {secrets.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="border border-amber-400/20 bg-amber-900/10 rounded p-6"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Lock className="w-5 h-5 text-amber-400" />
                    <h3 className="text-lg font-mono text-amber-400 tracking-wider uppercase">
                      Secrets & Revelations
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {secrets.map(secret => (
                      <div key={secret.id} className="p-3 bg-black/40 border border-amber-400/20 rounded">
                        <p className="font-mono text-sm text-amber-300 font-semibold mb-1">
                          {secret.title}
                        </p>
                        <p className="text-[9px] font-mono text-amber-400/80 leading-relaxed">
                          {secret.content?.slice(0, 150)}...
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Personality Traits */}
              {traits.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="border border-purple-400/20 bg-purple-900/10 rounded p-6"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-mono text-purple-400 tracking-wider uppercase">
                      Evolving Traits
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {traits.map(trait => (
                      <div key={trait.id} className="p-2 bg-black/40 border border-purple-400/20 rounded">
                        <p className="text-[9px] font-mono text-purple-300 truncate">
                          {trait.title}
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Empty State */}
              {charRelationships.length === 0 && secrets.length === 0 && traits.length === 0 && (
                <div className="border border-primary/10 bg-black/40 rounded p-8 text-center">
                  <p className="font-mono text-sm text-primary/30 tracking-widest uppercase">
                    No character data accumulated yet
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}