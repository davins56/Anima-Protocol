import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useStoreSync } from '@/lib/useStoreSync';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader, BookOpen, Sparkles } from 'lucide-react';

// The Book of Echoes — a permanent journal the Anima writes about the bond.
// Entries are generated automatically during conversation (see Chat.jsx) and
// stored as BookOfEcho rows (schemaless base44 store, no migration).

function fmtDay(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return '';
  }
}

function groupByDay(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = fmtDay(e.entry_date || e.created_date) || 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return Array.from(groups.entries());
}

export default function BookOfEchoes() {
  const navigate = useNavigate();
  const [anima, setAnima] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const me = await base44.auth.me().catch(() => null);
      const [animas, echoes] = await Promise.all([
        base44.entities.Anima.list().catch(() => []),
        base44.entities.BookOfEcho.list('-entry_date').catch(() =>
          base44.entities.BookOfEcho.list('-created_date').catch(() => []),
        ),
      ]);
      const primary = animas?.find((a) => a.assigned_user === me?.email) || animas?.[0] || null;
      setAnima(primary);
      // Newest first for display.
      const sorted = [...(echoes || [])].sort(
        (a, b) =>
          new Date(b.entry_date || b.created_date || 0) -
          new Date(a.entry_date || a.created_date || 0),
      );
      setEntries(sorted);
    } catch {
      // restricted context
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useStoreSync(load);

  const days = groupByDay(entries);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-sm text-primary tracking-[0.25em] uppercase">Book of Echoes</h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">// The Anima's Journal</p>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto px-4 sm:px-6 py-8"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader className="w-6 h-6 text-primary/50 animate-spin" />
            <p className="font-mono text-xs text-primary/50 tracking-[0.3em] uppercase">Turning the pages…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <BookOpen className="w-10 h-10 text-amber-400/40 mx-auto" />
            <h2 className="font-mono text-base text-primary/80 uppercase tracking-wider">The book is still blank</h2>
            <p className="font-mono text-xs text-primary/40 leading-relaxed max-w-sm mx-auto">
              As you and {anima?.name || 'your Anima'} speak, they will quietly write down what
              passes between you. Return after a real conversation, and the first entries will appear here.
            </p>
            <button
              onClick={() => navigate('/chat')}
              className="px-6 py-3 btn-sacred text-primary font-mono text-sm tracking-widest uppercase inline-flex items-center gap-2 hud-corner"
            >
              <Sparkles className="w-4 h-4" /> Begin a conversation
            </button>
          </div>
        ) : (
          <div className="space-y-10">
            <div className="text-center">
              <p className="font-mono text-[10px] tracking-[0.3em] text-amber-400/50 uppercase">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · written by {anima?.name || 'your Anima'}
              </p>
            </div>

            {/* Timeline of entries grouped by day */}
            <div className="relative pl-6 border-l border-amber-500/20 space-y-8">
              {days.map(([day, dayEntries]) => (
                <div key={day} className="space-y-4">
                  <div className="relative">
                    <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-amber-400/60 shadow-[0_0_10px_rgba(251,191,36,0.6)]" />
                    <p className="font-mono text-[10px] tracking-[0.3em] text-amber-300/60 uppercase">{day}</p>
                  </div>
                  {dayEntries.map((e) => (
                    <motion.div
                      key={e.id || `${day}-${e.content?.slice(0, 12)}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border border-amber-500/15 bg-amber-950/5 p-5"
                    >
                      <p className="font-serif text-base text-amber-50/90 leading-relaxed italic">
                        “{e.content}”
                      </p>
                      {e.theme && (
                        <p className="font-mono text-[8px] tracking-[0.3em] text-amber-400/40 uppercase mt-3">
                          {e.theme}
                        </p>
                      )}
                    </motion.div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
