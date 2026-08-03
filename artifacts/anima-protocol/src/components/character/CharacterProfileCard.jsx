import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Heart, TrendingUp, Users, Award } from 'lucide-react';
import { motion } from 'framer-motion';

export default function CharacterProfileCard({ characterId, sessionId }) {
  const [character, setCharacter] = useState(null);
  const [relationships, setRelationships] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfileData();
  }, [characterId, sessionId]);

  const loadProfileData = async () => {
    setLoading(true);
    try {
      const [char, rels, prof] = await Promise.all([
        base44.entities.Character.list().then(chars => chars?.find(c => c.id === characterId)),
        base44.entities.CharacterRelationship.filter({ character_a_id: characterId, session_id: sessionId || '' }),
        base44.entities.ResonanceProfile.filter({ user_email: '' }).then(ps => ps?.[0]),
      ]);
      setCharacter(char);
      setRelationships(rels || []);
      setProfile(prof);
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !character) return null;

  const getTierColor = (tier) => {
    const colors = {
      hostile: '#EF4444',
      cold: '#F97316',
      neutral: '#6B7280',
      warm: '#84CC16',
      close: '#06B6D4',
      devoted: '#EC4899',
    };
    return colors[tier] || '#6B7280';
  };

  const getTierLabel = (tier) => {
    const labels = {
      hostile: 'Hostile',
      cold: 'Cold',
      neutral: 'Neutral',
      warm: 'Warm',
      close: 'Close',
      devoted: 'Devoted',
    };
    return labels[tier] || 'Unknown';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/40 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-primary/10 border-b border-primary/10 flex items-start gap-3">
        {character.avatar_url ? (
          <img src={character.avatar_url} alt={character.name} className="w-12 h-12 rounded border border-primary/30 object-cover" />
        ) : (
          <div className="w-12 h-12 rounded border border-primary/30 bg-primary/20 flex items-center justify-center">
            <span className="text-primary font-mono font-bold">{character.name[0]}</span>
          </div>
        )}
        <div className="flex-1">
          <h3 className="font-mono text-sm text-primary tracking-wider uppercase">{character.name}</h3>
          {character.universe && (
            <p className="text-[9px] font-mono text-primary/50 mt-1">{character.universe}</p>
          )}
        </div>
      </div>

      {/* Character Info */}
      <div className="px-4 py-3 space-y-2 border-b border-primary/10">
        {character.personality && (
          <p className="text-[9px] font-mono text-primary/70 leading-relaxed line-clamp-2">
            {character.personality}
          </p>
        )}
      </div>

      {/* Relationships Section */}
      {relationships.length > 0 && (
        <div className="px-4 py-3 border-b border-primary/10">
          <div className="flex items-center gap-2 mb-3">
            <Heart className="w-4 h-4 text-pink-400" />
            <h4 className="font-mono text-[9px] text-pink-400 tracking-widest uppercase">Relationships</h4>
          </div>
          <div className="space-y-2.5">
            {relationships.map((rel) => (
              <motion.div
                key={rel.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[8px] font-mono text-primary/70 truncate">{rel.character_b_name}</span>
                  <span className="text-[8px] font-mono text-primary/50">{rel.score}/100</span>
                </div>
                <div className="w-full h-1.5 bg-black/40 border border-primary/10 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(rel.score, 0)}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ backgroundColor: getTierColor(rel.tier) }}
                    className="h-full"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[7px] font-mono text-primary/40">{getTierLabel(rel.tier)}</span>
                  {rel.last_delta && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`text-[7px] font-mono font-bold ${rel.last_delta > 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {rel.last_delta > 0 ? '+' : ''}{rel.last_delta}
                    </motion.span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Profile Stats */}
      {profile && (
        <div className="px-4 py-3 flex items-center gap-4 text-[9px] font-mono">
          <div className="flex items-center gap-1.5">
            <Award className="w-3 h-3 text-yellow-400" />
            <div>
              <p className="text-primary/50">Rank</p>
              <p className="text-primary/80 font-bold">{profile.resonance_rank}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            <div>
              <p className="text-primary/50">XP</p>
              <p className="text-primary/80 font-bold">{profile.resonance_xp}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3 h-3 text-purple-400" />
            <div>
              <p className="text-primary/50">Sessions</p>
              <p className="text-primary/80 font-bold">{profile.total_sessions || 0}</p>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}