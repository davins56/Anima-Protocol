import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import RelationshipNodeGraph from '@/components/graph/RelationshipNodeGraph';
import { ArrowLeft, Users, Heart, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

export default function RelationshipNodeGraphPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState({});
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRelationships: 0,
    positiveRelationships: 0,
    negativeRelationships: 0,
    averageIntensity: 0,
  });

  useEffect(() => {
    loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load characters for the session
      const [charList, relList] = await Promise.all([
        base44.entities.Character.list('-created_date', 500),
        sessionId ? base44.entities.CharacterRelationship.filter({ session_id: sessionId }) : Promise.resolve([]),
      ]);

      setCharacters(charList || []);

      // Build relationships map
      const relMap = {};
      let positiveCount = 0;
      let negativeCount = 0;
      let totalIntensity = 0;

      (relList || []).forEach((rel) => {
        relMap[rel.character_a_id] = {
          character_id: rel.character_b_id,
          character_name: rel.character_b_name,
          score: rel.score || 0,
          tier: rel.tier || 'neutral',
          last_interaction: rel.last_interaction,
          trust_level: rel.trust_level,
        };

        if (rel.score > 0) positiveCount++;
        if (rel.score < 0) negativeCount++;
        totalIntensity += Math.abs(rel.score || 0);
      });

      setRelationships(relMap);
      setStats({
        totalRelationships: relList?.length || 0,
        positiveRelationships: positiveCount,
        negativeRelationships: negativeCount,
        averageIntensity: relList?.length ? Math.round(totalIntensity / relList.length) : 0,
      });
    } catch (err) {
      console.error('Error loading relationship data:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedCharacter = selectedNode && characters.find(c => c.id === selectedNode.id);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-primary/40 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">
              Relationship Network
            </h1>
            <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-2">
              Interactive character connection graph
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 border border-primary/20 bg-black/40 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-3.5 h-3.5 text-primary/50" />
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Characters</p>
            </div>
            <p className="font-mono text-[10px] text-primary font-semibold">{characters.length}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="p-3 border border-primary/20 bg-black/40 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-primary/50" />
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Total</p>
            </div>
            <p className="font-mono text-[10px] text-primary font-semibold">{stats.totalRelationships}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-3 border border-green-400/20 bg-green-900/10 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <Heart className="w-3.5 h-3.5 text-green-400" />
              <p className="text-[8px] font-mono text-green-400/60 tracking-widest uppercase">Positive</p>
            </div>
            <p className="font-mono text-[10px] text-green-400 font-semibold">{stats.positiveRelationships}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="p-3 border border-red-400/20 bg-red-900/10 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <Heart className="w-3.5 h-3.5 text-red-400" />
              <p className="text-[8px] font-mono text-red-400/60 tracking-widest uppercase">Negative</p>
            </div>
            <p className="font-mono text-[10px] text-red-400 font-semibold">{stats.negativeRelationships}</p>
          </motion.div>
        </div>

        {/* Graph Container */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="h-[700px] border border-primary/20 bg-black/40 rounded-lg overflow-hidden"
        >
          {loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Loading graph...</p>
              </div>
            </div>
          ) : (
            <RelationshipNodeGraph
              characters={characters}
              relationships={relationships}
              onNodeSelect={setSelectedNode}
              selectedCharacterId={selectedNode?.id}
            />
          )}
        </motion.div>

        {/* Selected Character Details */}
        {selectedCharacter && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {/* Character Card */}
            <div className="p-4 border border-cyan-400/20 bg-cyan-900/10 rounded-lg md:col-span-1">
              <div className="space-y-3">
                {selectedCharacter.avatar_url && (
                  <img
                    src={selectedCharacter.avatar_url}
                    alt={selectedCharacter.name}
                    className="w-full aspect-square object-cover border border-cyan-400/20 rounded"
                  />
                )}
                <div>
                  <h3 className="font-mono text-[10px] text-cyan-400 tracking-widest uppercase font-semibold">
                    {selectedCharacter.name}
                  </h3>
                  {selectedCharacter.universe && (
                    <p className="text-[8px] text-cyan-400/60 mt-1">{selectedCharacter.universe}</p>
                  )}
                  {selectedCharacter.category && (
                    <p className="text-[8px] text-cyan-400/60 mt-1 capitalize">{selectedCharacter.category}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Relationships List */}
            <div className="md:col-span-2 p-4 border border-cyan-400/20 bg-cyan-900/10 rounded-lg space-y-3">
              <h4 className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase font-semibold">
                Connected To
              </h4>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {Object.entries(relationships)
                  .filter(([id]) => id === selectedCharacter.id)
                  .flatMap(([_, rel]) => [
                    <div
                      key={rel.character_id}
                      className="p-2 border border-cyan-400/20 bg-black/30 rounded space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[8px] font-mono text-cyan-400 font-semibold">
                          {rel.character_name}
                        </span>
                        <span
                          className={`text-[7px] font-mono px-1.5 py-0.5 rounded ${
                            rel.score > 0
                              ? 'bg-green-400/20 text-green-400'
                              : rel.score < 0
                              ? 'bg-red-400/20 text-red-400'
                              : 'bg-primary/10 text-primary/60'
                          }`}
                        >
                          {rel.score > 0 ? '+' : ''}{rel.score}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[7px] text-cyan-400/60">
                        <span className="uppercase">{rel.tier}</span>
                        {rel.trust_level && (
                          <span>Trust: {Math.round(rel.trust_level * 100)}%</span>
                        )}
                      </div>
                    </div>,
                  ])}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}