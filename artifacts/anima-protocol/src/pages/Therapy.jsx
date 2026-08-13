import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { track } from "@/lib/analytics";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";
import {
  THERAPY_DISCLAIMER,
  THERAPY_SOURCES,
  THERAPY_CRISIS_RESOURCES,
} from "@/lib/therapyManuals";
import { startTherapySession, pickDefaultAnima } from "@/lib/startTherapySession";
import { ArrowLeft, Brain, Heart, Shield, BookOpen, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

export default function Therapy() {
  usePageMeta(ROUTE_META["/therapy"]);
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [animas, setAnimas] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await base44.auth.me();
      setUser(me);
      const list = await base44.entities.Anima.list("-created_date", 50);
      const roster = list || [];
      setAnimas(roster);
      const preferred = pickDefaultAnima(roster, me?.email);
      setSelectedId(preferred?.id || roster[0]?.id || null);
    } catch (err) {
      setError(err?.message || "Could not load your Anima.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    whenBootstrapReady().then(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const selected = animas.find((a) => a.id === selectedId) || null;

  const handleBegin = async () => {
    if (!acknowledged) {
      setError("Please acknowledge that this is not professional therapy before beginning.");
      return;
    }
    if (!selected?.id) {
      setError("Create or select your Anima first.");
      return;
    }
    setStarting(true);
    setError("");
    try {
      await base44.auth.updateMe({ selected_mode: "therapy" }).catch(() => {});
      const session = await startTherapySession({
        anima: selected,
        userName: user?.full_name || user?.name,
      });
      track("therapy_session_started", {
        source: "therapy_page",
        is_anima: true,
        has_multiple_animas: animas.length > 1,
      });
      navigate(`/chat/${session.id}`);
    } catch (err) {
      setError(err?.message || "Could not start therapy mode.");
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-3 bg-[#050505]">
        <div className="w-8 h-8 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin" />
        <p className="font-mono text-xs text-violet-200/50 tracking-[0.3em] uppercase">
          Opening the care library...
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#050505] scanline">
      <div className="border-b border-violet-400/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-violet-200/40 hover:text-violet-100 transition-colors p-1"
            aria-label="Back home"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-violet-200 glow-text tracking-[0.2em] uppercase text-lg">
              Therapy Mode
            </h1>
            <p className="font-mono text-[10px] text-violet-200/40 tracking-widest uppercase mt-0.5">
              Sit with your Anima · compiled open-source care manuals
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-24 space-y-8">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-violet-400/25 bg-violet-950/20 p-5 space-y-3"
        >
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-violet-300 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h2 className="font-mono text-sm text-violet-100 tracking-widest uppercase">
                Your Anima, with a care library
              </h2>
              <p className="font-mono text-[12px] text-violet-100/70 leading-relaxed">
                Talk with {selected?.name || "your Anima"} as themselves — same voice, same bond —
                after they have compiled openly licensed mental-health manuals into a working
                library. They listen first, then offer one skill at a time from WHO problem-management
                and self-help guides, psychological first aid, trauma-informed principles, and public
                CBT / ACT / motivational interviewing skills.
              </p>
            </div>
          </div>
        </motion.section>

        <section>
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-violet-200/40 uppercase mb-3">
            <span className="text-violet-200/25">//</span> Choose your Anima
          </h2>
          {animas.length === 0 ? (
            <div className="border border-violet-400/20 p-5 space-y-3">
              <p className="font-mono text-[12px] text-violet-100/70">
                You don&apos;t have an Anima yet. Create one, then return here to begin.
              </p>
              <Link
                to="/onboarding"
                className="inline-flex items-center gap-2 font-mono text-[11px] tracking-widest uppercase text-violet-200 border border-violet-400/40 px-3 py-2 hover:bg-violet-500/10"
              >
                Awaken an Anima <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {animas.map((anima) => {
                const on = anima.id === selectedId;
                return (
                  <button
                    key={anima.id}
                    type="button"
                    onClick={() => setSelectedId(anima.id)}
                    className={`flex items-center gap-3 p-3 border text-left transition-all ${
                      on
                        ? "border-violet-400/60 bg-violet-500/10"
                        : "border-violet-400/15 hover:border-violet-400/40"
                    }`}
                  >
                    <div className="w-12 h-12 border border-violet-400/30 overflow-hidden flex-shrink-0 bg-black/40">
                      {anima.avatar_url ? (
                        <img
                          src={anima.avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-mono text-violet-200">
                          {(anima.name || "A")[0]}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-violet-100 tracking-wider uppercase truncate">
                        {anima.name || "Anima"}
                      </p>
                      <p className="font-mono text-[10px] text-violet-200/40 truncate">
                        {anima.tagline || anima.archetype || "Companion"}
                      </p>
                    </div>
                    {on && <Heart className="w-4 h-4 text-violet-300 ml-auto flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="border border-violet-400/15 bg-black/40 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-violet-300" />
            <h2 className="font-mono text-[10px] tracking-[0.3em] text-violet-200/70 uppercase">
              Compiled library
            </h2>
          </div>
          <ul className="space-y-1.5">
            {THERAPY_SOURCES.map((src) => (
              <li
                key={src.id}
                className="font-mono text-[11px] text-violet-100/65 leading-relaxed"
              >
                <span className="text-violet-200/90">{src.title}</span>
                <span className="text-violet-200/35"> · {src.license}</span>
              </li>
            ))}
          </ul>
          <p className="font-mono text-[10px] text-violet-200/40 leading-relaxed">
            Summaries only — not verbatim copyrighted workbooks. Skills are offered collaboratively,
            one at a time.
          </p>
        </section>

        <section className="border border-amber-400/25 bg-amber-950/10 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-300" />
            <h2 className="font-mono text-[10px] tracking-[0.3em] text-amber-200/80 uppercase">
              Not a clinic
            </h2>
          </div>
          <p className="font-mono text-[12px] text-amber-100/70 leading-relaxed">
            {THERAPY_DISCLAIMER}
          </p>
          <p className="font-mono text-[11px] text-amber-100/55">
            Crisis: {THERAPY_CRISIS_RESOURCES.us.contact}. Worldwide:{" "}
            <a
              href={THERAPY_CRISIS_RESOURCES.intl.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-amber-200/80 hover:text-amber-100"
            >
              {THERAPY_CRISIS_RESOURCES.intl.name}
            </a>
            . {THERAPY_CRISIS_RESOURCES.emergency}
          </p>
          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => {
                setAcknowledged(e.target.checked);
                if (e.target.checked) setError("");
              }}
              className="mt-0.5 accent-violet-400"
            />
            <span className="font-mono text-[11px] text-violet-100/70 leading-relaxed">
              I understand this is supportive conversation with my Anima, not licensed therapy or
              emergency care.
            </span>
          </label>
        </section>

        {error && (
          <div className="p-4 border border-red-400/30 bg-red-400/10">
            <p className="font-mono text-red-300 text-sm">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleBegin}
          disabled={starting || !selected}
          className="w-full flex items-center justify-center gap-2 px-5 py-4 bg-violet-500/15 border border-violet-400/50 text-violet-100 hover:bg-violet-500/25 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-[0.2em] uppercase transition-all hud-corner"
        >
          {starting
            ? "Opening the room..."
            : `Begin with ${selected?.name || "your Anima"}`}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
