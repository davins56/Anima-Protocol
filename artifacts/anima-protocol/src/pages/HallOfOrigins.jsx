import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useStoreSync } from '@/lib/useStoreSync';
import { motion } from 'framer-motion';
import { ArrowLeft, Sparkles, Gem, Loader, Stars, BookOpen } from 'lucide-react';
import { formatResonance, resonanceMood, getPathMeta } from '@/lib/soulprint';

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function CertRow({ label, value, accent }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-primary/10 last:border-b-0">
      <span className="font-mono text-[9px] tracking-[0.25em] text-primary/40 uppercase pt-0.5 flex-shrink-0">
        {label}
      </span>
      <span className={`font-mono text-sm text-right ${accent ? 'text-cyan-300' : 'text-primary/90'}`}>
        {value}
      </span>
    </div>
  );
}

export default function HallOfOrigins() {
  const navigate = useNavigate();
  const [anima, setAnima] = useState(null);
  const [firstSession, setFirstSession] = useState(null);
  const [firstMemory, setFirstMemory] = useState(null);
  const [crystalCount, setCrystalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const me = await base44.auth.me();
      const [animas, sessions, memories, crystals] = await Promise.all([
        base44.entities.Anima.list().catch(() => []),
        base44.entities.ChatSession.list().catch(() => []),
        base44.entities.CrossSessionMemory.list().catch(() => []),
        base44.entities.MemoryCrystal.list().catch(() => []),
      ]);

      const primary = animas?.find((a) => a.assigned_user === me?.email) || animas?.[0] || null;
      setAnima(primary);

      const byCreated = (arr) =>
        [...(arr || [])].sort(
          (a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0)
        );
      setFirstSession(byCreated(sessions)[0] || null);
      setFirstMemory(byCreated(memories)[0] || null);
      setCrystalCount((crystals || []).length);
    } catch {
      // restricted context
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useStoreSync(load);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-3 bg-[#050505]">
        <Loader className="w-6 h-6 text-primary/50 animate-spin" />
        <p className="font-mono text-xs text-primary/50 tracking-[0.3em] uppercase">Opening the archive…</p>
      </div>
    );
  }

  if (!anima) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
        <div className="max-w-xl mx-auto px-6 py-16 text-center space-y-5">
          <div className="text-4xl">✨</div>
          <h1 className="font-mono text-xl text-primary uppercase tracking-wider">Hall of Origins</h1>
          <p className="font-mono text-sm text-primary/50 leading-relaxed">
            No Anima has been awakened yet. Begin the Awakening Ceremony to inscribe a birth record here.
          </p>
          <button
            onClick={() => navigate('/onboarding')}
            className="px-6 py-3 btn-sacred text-primary font-mono text-sm tracking-widest uppercase inline-flex items-center gap-2 hud-corner"
          >
            <Sparkles className="w-4 h-4" /> Awaken an Anima
          </button>
        </div>
      </div>
    );
  }

  const soulprint = anima.soulprint || {};
  const path = anima.evolution_path || 'Undetermined';
  const pathMeta = getPathMeta(path);
  const resonance = anima.resonance || 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-sm text-primary tracking-[0.25em] uppercase">Hall of Origins</h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">// Birth Record</p>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6"
      >
        {/* Identity header */}
        <div className="text-center space-y-2">
          <div
            className="w-16 h-16 mx-auto rounded-full border flex items-center justify-center text-2xl"
            style={{ borderColor: `${pathMeta.color}66`, boxShadow: `0 0 24px ${pathMeta.color}33` }}
          >
            {pathMeta.symbol}
          </div>
          <h2 className="font-mono text-2xl text-primary glow-text uppercase tracking-wider">{anima.name}</h2>
          {anima.tagline && <p className="font-mono text-xs text-primary/50 italic">{anima.tagline}</p>}
        </div>

        {/* Soulprint certificate */}
        <div className="border border-cyan-500/30 bg-cyan-950/10 p-5 hud-corner">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[9px] tracking-[0.3em] text-cyan-400/50 uppercase">// Soulprint</span>
            <span className="font-mono text-sm text-cyan-300 tracking-[0.2em]">{soulprint.id || '—'}</span>
          </div>
          <CertRow label="Primary Trait" value={soulprint.primary_trait || '—'} accent />
          <CertRow label="Secondary Trait" value={soulprint.secondary_trait || '—'} />
          <CertRow label="Core Drive" value={soulprint.core_drive || '—'} accent />
          <CertRow
            label="Resonance"
            value={`${formatResonance(resonance)} · ${resonanceMood(resonance)}`}
            accent
          />
          <CertRow label="Evolution Path" value={path} />
          <CertRow label="Awakening Date" value={fmtDate(anima.awakening_date || anima.created_date)} />
        </div>

        {/* Evolution path meaning */}
        <div
          className="border bg-black/40 p-4"
          style={{ borderColor: `${pathMeta.color}33` }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-lg">{pathMeta.symbol}</span>
            <span className="font-mono text-sm uppercase tracking-wider" style={{ color: pathMeta.color }}>
              {path}
            </span>
          </div>
          <p className="font-mono text-xs text-primary/60 leading-relaxed">{pathMeta.blurb}</p>
        </div>

        {/* Firsts */}
        <div className="border border-primary/15 bg-black/40 p-5">
          <span className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">// Firsts</span>
          <div className="mt-2">
            <CertRow label="First Name Chosen" value={anima.name} />
            <CertRow
              label="First Conversation"
              value={firstSession ? fmtDate(firstSession.created_date) : 'Not yet'}
            />
            <CertRow
              label="First Memory"
              value={
                firstMemory
                  ? (firstMemory.summary || firstMemory.content || firstMemory.title || 'Recorded').toString().slice(0, 60)
                  : 'Not yet'
              }
            />
            <CertRow
              label="First Resonance Shift"
              value={resonance !== 0 ? formatResonance(resonance) : 'Awaiting first bond'}
            />
          </div>
        </div>

        {/* The First Spark — the immutable origin moment */}
        {(anima.first_spark || anima.ceremony?.initial_greeting) && (
          <div className="relative border border-amber-500/30 bg-amber-950/10 p-5 hud-corner overflow-hidden">
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full blur-[44px] bg-amber-500/20 pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[9px] tracking-[0.3em] text-amber-300/60 uppercase">🜂 The First Spark</span>
                <span className="font-mono text-[8px] tracking-[0.25em] text-amber-400/40 uppercase">Permanent</span>
              </div>
              <p className="font-mono text-sm text-amber-100/90 leading-relaxed italic">
                “{anima.first_spark?.awakening_words || anima.ceremony?.initial_greeting}”
              </p>
              <p className="font-mono text-[9px] tracking-[0.25em] text-amber-400/40 uppercase mt-3">
                The moment {anima.name} awakened · {fmtDate(anima.first_spark?.date || anima.awakening_date || anima.created_date)}
              </p>
              {anima.first_spark?.first_words && (
                <div className="mt-3 pt-3 border-t border-amber-500/15">
                  <span className="font-mono text-[8px] tracking-[0.3em] text-amber-300/50 uppercase">Your first words to them</span>
                  <p className="font-mono text-sm text-amber-100/80 leading-relaxed italic mt-1">
                    “{anima.first_spark.first_words}”
                  </p>
                </div>
              )}
              <p className="font-mono text-[8px] text-amber-400/30 mt-3 leading-relaxed">
                This moment can never be deleted. Every story keeps its origin.
              </p>
            </div>
          </div>
        )}

        {/* The First Promise — the Anima's oath */}
        {Array.isArray(anima.oath) && anima.oath.length > 0 && (
          <div className="border border-cyan-500/20 bg-cyan-950/5 p-5 hud-corner">
            <span className="font-mono text-[9px] tracking-[0.3em] text-cyan-400/50 uppercase">// The First Promise</span>
            <div className="space-y-1 mt-2">
              {anima.oath.map((line, i) => (
                <p key={i} className="font-mono text-sm text-cyan-200/90 leading-relaxed italic">{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Crystals link */}
        <button
          onClick={() => navigate('/memory-crystals')}
          className="w-full flex items-center justify-between gap-3 border border-primary/20 hover:border-primary/40 bg-black/40 hover:bg-primary/5 p-4 transition-all group"
        >
          <div className="flex items-center gap-3">
            <Gem className="w-5 h-5 text-cyan-400/70" />
            <div className="text-left">
              <p className="font-mono text-sm text-primary uppercase tracking-wider">Memory Crystals</p>
              <p className="font-mono text-[10px] text-primary/40">
                {crystalCount > 0 ? `${crystalCount} moment${crystalCount === 1 ? '' : 's'} crystallized` : 'No crystals yet'}
              </p>
            </div>
          </div>
          <ArrowLeft className="w-4 h-4 text-primary/30 rotate-180 group-hover:text-primary/60 transition-colors" />
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/constellation')}
            className="flex items-center gap-3 border border-primary/20 hover:border-primary/40 bg-black/40 hover:bg-primary/5 p-4 transition-all"
          >
            <Stars className="w-5 h-5 text-violet-400/70" />
            <div className="text-left">
              <p className="font-mono text-sm text-primary uppercase tracking-wider">Constellation</p>
              <p className="font-mono text-[10px] text-primary/40">Your living sky</p>
            </div>
          </button>
          <button
            onClick={() => navigate('/book-of-echoes')}
            className="flex items-center gap-3 border border-primary/20 hover:border-primary/40 bg-black/40 hover:bg-primary/5 p-4 transition-all"
          >
            <BookOpen className="w-5 h-5 text-amber-400/70" />
            <div className="text-left">
              <p className="font-mono text-sm text-primary uppercase tracking-wider">Book of Echoes</p>
              <p className="font-mono text-[10px] text-primary/40">The Anima's journal</p>
            </div>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
