import { useEffect, useState } from 'react';
import { Brain, Shield, Activity, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';

export default function InventoryStatDisplay({ characterId, sessionId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!characterId || !sessionId) return;
    
    const fetchStats = async () => {
      try {
        const result = await base44.functions.invoke('calculateInventoryStats', {
          character_id: characterId,
          session_id: sessionId,
        });
        setStats(result.data);
      } catch (err) {
        console.error('Stats fetch failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [characterId, sessionId]);

  if (loading || !stats) return null;

  const statIcons = {
    strength: <Activity className="w-3 h-3 text-red-400" />,
    dexterity: <Zap className="w-3 h-3 text-yellow-400" />,
    constitution: <Shield className="w-3 h-3 text-orange-400" />,
    intelligence: <Brain className="w-3 h-3 text-blue-400" />,
    wisdom: <Brain className="w-3 h-3 text-purple-400" />,
    charisma: <Brain className="w-3 h-3 text-pink-400" />,
  };

  const getStatColor = (value) => {
    if (value > 10) return 'text-green-400';
    if (value > 5) return 'text-cyan-400';
    if (value > 0) return 'text-primary/80';
    if (value < -5) return 'text-red-400';
    return 'text-primary/50';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 border border-primary/20 bg-black/30 rounded space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[8px] text-primary/50 tracking-widest uppercase">Equipped Stats</span>
        <span className="text-[7px] font-mono text-primary/40">
          {stats.equipped_items?.length || 0} items
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {Object.entries(stats.stats || {}).map(([stat, value]) => (
          <div key={stat} className="flex items-center gap-1 p-1 border border-primary/10 bg-black/50 rounded">
            {statIcons[stat]}
            <div className="flex-1 min-w-0">
              <p className="text-[7px] font-mono text-primary/40 uppercase">{stat.slice(0, 3)}</p>
              <p className={`text-[8px] font-mono font-semibold ${getStatColor(value)}`}>
                {value > 0 ? '+' : ''}{value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Effects */}
      {stats.effects?.length > 0 && (
        <div className="pt-1 border-t border-primary/10 space-y-0.5">
          <p className="text-[7px] font-mono text-primary/40 tracking-widest uppercase">Effects</p>
          <div className="flex flex-wrap gap-1">
            {stats.effects.map(effect => (
              <span
                key={effect}
                className="text-[7px] font-mono px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary/70 rounded"
              >
                {effect}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Total Value */}
      {stats.total_value > 0 && (
        <div className="pt-1 border-t border-primary/10 flex items-center justify-between">
          <span className="text-[7px] font-mono text-primary/40">Total Trade Value</span>
          <span className="text-[8px] font-mono text-cyan-400 font-semibold">{stats.total_value} gp</span>
        </div>
      )}
    </motion.div>
  );
}