import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useStoreSync } from '@/lib/useStoreSync';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader } from 'lucide-react';
import MemoryCrystalVault from '@/components/lore/MemoryCrystalVault';

export default function MemoryCrystals() {
  const navigate = useNavigate();
  const [crystals, setCrystals] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [crys, sess] = await Promise.all([
        base44.entities.MemoryCrystal.list('-created_date').catch(() => []),
        base44.entities.ChatSession.list().catch(() => []),
      ]);
      setCrystals(crys || []);
      setSessions(sess || []);
    } catch {
      // restricted context
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useStoreSync(load);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-sm text-primary tracking-[0.25em] uppercase">Memory Crystals</h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">// Crystallized Moments</p>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto px-4 sm:px-6 py-8"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader className="w-6 h-6 text-primary/50 animate-spin" />
            <p className="font-mono text-xs text-primary/50 tracking-[0.3em] uppercase">Gathering crystals…</p>
          </div>
        ) : (
          <MemoryCrystalVault crystals={crystals} sessions={sessions} />
        )}
      </motion.div>
    </div>
  );
}
