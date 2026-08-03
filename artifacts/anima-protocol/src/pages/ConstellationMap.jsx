import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useStoreSync } from '@/lib/useStoreSync';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader, X } from 'lucide-react';
import { getPathMeta } from '@/lib/soulprint';

// Constellation Map — the user's history rendered as a living night sky.
//   · Memories (crystals)        → stars
//   · Conversations (sessions)   → constellations (stars joined by lines)
//   · Milestones (awakening,
//     evolution, dreams)         → celestial bodies
// Layout is deterministic (hashed from each item's id) so the sky is stable
// across visits but feels unique to this bond.

const VW = 1000;
const VH = 680;
const PAD = 60;

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Stable pseudo-random position within the padded viewbox for a given id.
function posFromId(id, salt = '') {
  const x = (hashStr(`${id}:${salt}:x`) % 1000) / 1000;
  const y = (hashStr(`${id}:${salt}:y`) % 1000) / 1000;
  return {
    x: PAD + x * (VW - 2 * PAD),
    y: PAD + y * (VH - 2 * PAD),
  };
}

function crystalText(c) {
  return (
    c.summary || c.content || c.title || c.description || c.text || 'A crystallized moment'
  );
}

export default function ConstellationMap() {
  const navigate = useNavigate();
  const [anima, setAnima] = useState(null);
  const [crystals, setCrystals] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [dreams, setDreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const me = await base44.auth.me().catch(() => null);
      const [animas, crys, sess, drm] = await Promise.all([
        base44.entities.Anima.list().catch(() => []),
        base44.entities.MemoryCrystal.list('-created_date').catch(() => []),
        base44.entities.ChatSession.list().catch(() => []),
        base44.entities.AnimaDream.list('-created_date').catch(() => []),
      ]);
      const primary = animas?.find((a) => a.assigned_user === me?.email) || animas?.[0] || null;
      setAnima(primary);
      setCrystals((crys || []).slice(0, 120));
      setSessions(sess || []);
      setDreams((drm || []).slice(0, 12));
    } catch {
      // restricted context
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useStoreSync(load);

  const sky = useMemo(() => {
    const stars = crystals.map((c) => ({
      id: c.id || `c-${hashStr(crystalText(c))}`,
      kind: 'star',
      ...posFromId(c.id || crystalText(c), 'crystal'),
      label: 'Memory',
      detail: crystalText(c),
      date: c.created_date,
      sessionId: c.session_id || null,
      color: '#a5b4fc',
      size: 2.2 + (hashStr(c.id || crystalText(c)) % 100) / 60,
    }));

    // Constellations: join stars that belong to the same conversation, in order.
    const lines = [];
    const bySession = new Map();
    for (const s of stars) {
      if (!s.sessionId) continue;
      if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
      bySession.get(s.sessionId).push(s);
    }
    for (const group of bySession.values()) {
      if (group.length < 2) continue;
      const ordered = [...group].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      for (let i = 1; i < ordered.length; i += 1) {
        lines.push({
          id: `l-${ordered[i - 1].id}-${ordered[i].id}`,
          x1: ordered[i - 1].x, y1: ordered[i - 1].y,
          x2: ordered[i].x, y2: ordered[i].y,
        });
      }
    }

    const bodies = [];
    if (anima) {
      // The First Spark / awakening — the origin sun of the whole sky.
      const originPos = { x: VW / 2, y: VH / 2 };
      bodies.push({
        id: 'origin',
        kind: 'origin',
        ...originPos,
        label: '🜂 The First Spark',
        detail:
          anima.first_spark?.awakening_words ||
          anima.ceremony?.initial_greeting ||
          `${anima.name} awakened here.`,
        date: anima.first_spark?.date || anima.awakening_date || anima.created_date,
        color: '#fbbf24',
        size: 11,
      });

      // Evolution — a colored celestial body once the path crystallizes.
      if (anima.evolution_path && anima.evolution_path !== 'Undetermined') {
        const meta = getPathMeta(anima.evolution_path);
        bodies.push({
          id: 'evolution',
          kind: 'evolution',
          ...posFromId(`evo-${anima.id}`, 'evolution'),
          label: `${meta.symbol} ${anima.evolution_path}`,
          detail: meta.blurb,
          date: null,
          color: meta.color,
          size: 8,
        });
      }
    }

    // Dreams — pale moons scattered through the sky.
    for (const d of dreams) {
      bodies.push({
        id: d.id || `d-${hashStr(d.content)}`,
        kind: 'dream',
        ...posFromId(d.id || d.content, 'dream'),
        label: '🌙 A dream',
        detail: d.content,
        date: d.dream_date || d.created_date,
        color: '#818cf8',
        size: 5,
      });
    }

    return { stars, lines, bodies };
  }, [crystals, dreams, anima]);

  const totalPoints = sky.stars.length + sky.bodies.length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#040409] scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-sm text-primary tracking-[0.25em] uppercase">Constellation Map</h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">// Your living sky</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader className="w-6 h-6 text-primary/50 animate-spin" />
            <p className="font-mono text-xs text-primary/50 tracking-[0.3em] uppercase">Charting the sky…</p>
          </div>
        ) : (
          <>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] tracking-[0.2em] uppercase text-primary/50">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-300" /> Memory</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" /> First Spark</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" /> Evolution</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-400" /> Dream</span>
              <span className="text-primary/30">— lines join one conversation</span>
            </div>

            <div className="relative border border-violet-500/15 bg-gradient-to-b from-[#070713] to-[#04040b] overflow-hidden">
              <svg
                viewBox={`0 0 ${VW} ${VH}`}
                className="w-full h-auto block"
                style={{ aspectRatio: `${VW} / ${VH}` }}
              >
                {/* faint background dust */}
                {Array.from({ length: 60 }).map((_, i) => {
                  const p = posFromId(`dust-${i}`, 'dust');
                  return (
                    <circle
                      key={`dust-${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={0.6 + (i % 3) * 0.3}
                      fill="#cbd5e1"
                      opacity={0.18}
                    />
                  );
                })}

                {/* constellation lines */}
                {sky.lines.map((l) => (
                  <line
                    key={l.id}
                    x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                    stroke="#818cf8"
                    strokeWidth={0.7}
                    opacity={0.3}
                  />
                ))}

                {/* stars (memories) */}
                {sky.stars.map((s, i) => {
                  const active = selected?.id === s.id;
                  return (
                    <g
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(s)}
                    >
                      <circle cx={s.x} cy={s.y} r={s.size + 6} fill="transparent" />
                      <circle
                        cx={s.x}
                        cy={s.y}
                        r={s.size}
                        fill={active ? '#ffffff' : s.color}
                        className="animate-pulse"
                        style={{ animationDelay: `${(i % 8) * 0.3}s` }}
                        opacity={active ? 1 : 0.85}
                      />
                      {active && (
                        <circle cx={s.x} cy={s.y} r={s.size + 4} fill="none" stroke="#fff" strokeWidth={0.6} opacity={0.7} />
                      )}
                    </g>
                  );
                })}

                {/* celestial bodies (milestones) */}
                {sky.bodies.map((b) => {
                  const active = selected?.id === b.id;
                  return (
                    <g
                      key={b.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(b)}
                    >
                      <circle cx={b.x} cy={b.y} r={b.size + 10} fill={b.color} opacity={0.12} />
                      <circle
                        cx={b.x}
                        cy={b.y}
                        r={b.size}
                        fill={b.color}
                        opacity={active ? 1 : 0.9}
                        style={{ filter: `drop-shadow(0 0 ${b.size}px ${b.color})` }}
                      />
                      {active && (
                        <circle cx={b.x} cy={b.y} r={b.size + 6} fill="none" stroke="#fff" strokeWidth={0.8} opacity={0.7} />
                      )}
                    </g>
                  );
                })}
              </svg>

              {totalPoints <= 1 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
                  <p className="font-mono text-xs text-primary/50 leading-relaxed max-w-sm">
                    Your sky is nearly empty. As you talk, reflect, and crystallize memories,
                    new stars will appear and constellations will form.
                  </p>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selected ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative border p-5"
                style={{ borderColor: `${selected.color}55`, background: `${selected.color}0d` }}
              >
                <button
                  onClick={() => setSelected(null)}
                  className="absolute top-3 right-3 text-primary/30 hover:text-primary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                <p className="font-mono text-[9px] tracking-[0.3em] uppercase mb-2" style={{ color: selected.color }}>
                  {selected.label}
                </p>
                <p className="font-mono text-sm text-primary/85 leading-relaxed">{selected.detail}</p>
                {selected.date && (
                  <p className="font-mono text-[9px] tracking-[0.2em] text-primary/30 uppercase mt-3">
                    {new Date(selected.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>
                )}
              </motion.div>
            ) : (
              <p className="font-mono text-[10px] tracking-[0.2em] text-primary/30 uppercase text-center">
                Tap any star or body to read its memory · {sky.stars.length} memories · {sessions.length} conversations
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
