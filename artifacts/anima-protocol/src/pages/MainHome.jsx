import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44, uploadDataUrl, urlToDataUrl } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import { motion } from "framer-motion";
import { Moon, Plus, Sparkles } from "lucide-react";
import AvatarAIEditModal from "@/components/anima/AvatarAIEditModal";
import { openPhotoEditor } from "@/lib/avatarPhoto";
import { useAnimaPresence } from "@/hooks/useAnimaPresence";
import SerenityPresence from "@/components/anima/SerenityPresence";
import LivingPresence from "@/components/chat/LivingPresence";
import { getPathMeta } from "@/lib/soulprint";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import {
  resolveIdentity,
  resolveWaiting,
  resolveWakeLine,
  rollFlavorChance,
} from "@/lib/homeWake";
import HomeDock from "@/components/home/HomeDock";
import HomeFloorSheets from "@/components/home/HomeFloorSheets";

const APP_VERSION = "V4.3.0";
const LONG_PRESS_MS = 520;

export default function MainHome() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const photoInputRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const [anima, setAnima] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [lastCheckIn, setLastCheckIn] = useState(null);
  const [selectedMode, setSelectedMode] = useState("serenity");
  const [panel, setPanel] = useState(null);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [editSource, setEditSource] = useState(null);
  const [editingNewPhoto, setEditingNewPhoto] = useState(false);
  const [evolvePrompt, setEvolvePrompt] = useState("");
  const [flavorRoll] = useState(() => ({
    useFlavor: rollFlavorChance(),
    flavorIndex: Math.floor(Math.random() * 9),
  }));

  const handleApplyAiPhoto = async (dataUrl) => {
    if (!anima?.id) return;
    const file_url = await uploadDataUrl(dataUrl);
    await base44.entities.Anima.update(anima.id, { avatar_url: file_url });
    setAnima((prev) => (prev ? { ...prev, avatar_url: file_url } : prev));
  };

  const openEditExisting = async () => {
    const src = anima?.avatar_url || null;
    let source = src;
    if (src && !src.startsWith("data:")) {
      try {
        source = await urlToDataUrl(src);
      } catch (err) {
        console.debug("Couldn't inline avatar for editing", err);
      }
    }
    setEditSource(source);
    setEditingNewPhoto(false);
    setAiEditOpen(true);
  };

  const manifestEvolvedForm = async (path) => {
    const meta = getPathMeta(path);
    if (!meta) return;
    const src = anima?.avatar_url || null;
    let source = src;
    if (src && !src.startsWith("data:")) {
      try {
        source = await urlToDataUrl(src);
      } catch (err) {
        console.debug("Couldn't inline avatar for evolution", err);
      }
    }
    setEvolvePrompt(
      `Reimagine this portrait as an evolved "${path}" form. Infuse it with a luminous aura in the color ${meta.color}, subtle ${meta.symbol} motifs, and an air of ${(meta.keywords || []).slice(0, 3).join(", ") || "transcendence"}. Keep the same face and identity, elevated and transformed.`,
    );
    setEditSource(source);
    setEditingNewPhoto(false);
    setAiEditOpen(true);
  };

  const handlePhotoSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    openPhotoEditor(file, { setEditSource, setEditingNewPhoto, setAiEditOpen });
  };

  const loadHomeData = useCallback(async () => {
    try {
      const [me, sessionList, animas, checkIns] = await Promise.all([
        base44.auth.me(),
        base44.entities.ChatSession.list(),
        base44.entities.Anima.list(),
        base44.entities.CheckIn.list(),
      ]);
      setSelectedMode(me?.selected_mode || "serenity");

      const recent = [...(sessionList || [])]
        .sort((a, b) => new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0))
        .slice(0, 5);
      setSessions(recent);

      const userAnima = animas?.find((a) => a.assigned_user === me?.email) || animas?.[0] || null;
      setAnima(userAnima);

      const sortedCheckIns = [...(checkIns || [])].sort(
        (a, b) => new Date(b.timestamp || b.created_date || 0) - new Date(a.timestamp || a.created_date || 0),
      );
      if (sortedCheckIns.length > 0) setLastCheckIn(sortedCheckIns[0]);
    } catch (err) {
      console.debug("MainHome init in restricted context");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadHomeData();
    whenBootstrapReady().then(() => {
      if (!cancelled) loadHomeData();
    });
    return () => {
      cancelled = true;
    };
  }, [loadHomeData]);

  useStoreSync(loadHomeData);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      const spacing = 44;
      ctx.strokeStyle = "rgba(0, 229, 255, 0.05)";
      for (let x = 0; x < W; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, H); ctx.stroke();
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const handleTalk = useCallback(() => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (sessions.length > 0) navigate(`/chat/${sessions[0].id}`);
    else navigate("/chat");
  }, [navigate, sessions]);

  const handleSelectMode = async (key) => {
    setSelectedMode(key);
    try {
      await base44.auth.updateMe({ selected_mode: key });
    } catch (err) {
      console.debug("Could not persist mode selection");
    }
    setPanel(null);
    if (key === "therapy") navigate("/therapy");
  };

  const openFocus = () => {
    longPressFired.current = true;
    setPanel("focus");
  };

  const startLongPress = () => {
    longPressFired.current = false;
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(openFocus, LONG_PRESS_MS);
  };

  const endLongPress = () => {
    clearTimeout(longPressTimer.current);
  };

  const { dream, echo } = useAnimaPresence(anima);
  const wake = resolveWakeLine(dream, echo, flavorRoll);
  const waiting = resolveWaiting(anima?.last_visit);
  const identity = resolveIdentity(anima, { hasSignedInAnima: Boolean(anima?.id) });
  const firstRun = !anima?.id || sessions.length === 0;
  const stageCharacter = anima
    ? { ...anima, _isAnima: true }
    : { name: "Serenity", _isAnima: true };
  const canEditAvatar = Boolean(
    anima?.avatar_url?.startsWith("data:") || anima?.avatar_url?.startsWith("/api/storage"),
  );
  const canManifest = canEditAvatar;

  return (
    <div className="relative h-full bg-[#050505] scanline flex flex-col overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />

      <header
        data-home-status
        className="relative z-20 flex items-center justify-center gap-2 py-2 px-4 text-[8px] tracking-[0.55em] text-cyan-900 uppercase font-mono flex-shrink-0"
      >
        <span className="inline-block w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse" />
        Online · {APP_VERSION}
      </header>

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex flex-col min-h-full">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-2 mb-3"
            data-home-wake
          >
            <p className="font-mono text-[12px] tracking-wide leading-relaxed text-cyan-100/80 italic">
              {wake.text}
            </p>
            <p className="font-mono text-[11px] tracking-wider text-cyan-400">{identity}</p>
          </motion.div>

          <div className="flex-1 min-h-[220px] flex flex-col items-center justify-center">
            <SerenityPresence anima={anima} />

            <div
              data-home-stage
              className="relative flex items-end justify-center gap-6 pt-2"
              onPointerDown={startLongPress}
              onPointerUp={endLongPress}
              onPointerLeave={endLongPress}
              onPointerCancel={endLongPress}
              onContextMenu={(e) => {
                e.preventDefault();
                openFocus();
              }}
            >
              <LivingPresence
                character={stageCharacter}
                emotion="calm"
                resonance={anima?.resonance || 0}
                size={firstRun && !anima?.id ? 200 : 248}
                showLabel
                onExpand={handleTalk}
              />

              {firstRun && (
                <button
                  type="button"
                  onClick={() => navigate("/characters?create=1")}
                  data-home-create-slot
                  aria-label="Create a companion"
                  className="w-16 h-28 sm:w-20 sm:h-32 border border-dashed border-cyan-400/25 hover:border-cyan-400/55 bg-cyan-950/10 hover:bg-cyan-950/20 flex flex-col items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-5 h-5 text-cyan-400/50" />
                  <span className="font-mono text-[7px] tracking-widest text-cyan-400/40 uppercase text-center px-1">
                    Create
                  </span>
                </button>
              )}
            </div>

            <p className="font-mono text-[8px] tracking-[0.22em] uppercase text-cyan-800 mt-2">
              Tap to talk · Hold for Focus
            </p>
            <button
              type="button"
              onClick={() => setPanel("focus")}
              className="font-mono text-[8px] tracking-[0.28em] uppercase text-cyan-700 hover:text-cyan-400 mt-1"
            >
              Focus
            </button>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mt-3 mb-3" data-home-tiles>
            {dream?.content ? (
              <button
                type="button"
                onClick={handleTalk}
                className="max-w-[14rem] text-left border border-indigo-400/25 bg-indigo-950/20 px-3 py-2"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Moon className="w-3 h-3 text-indigo-300" />
                  <span className="font-mono text-[8px] tracking-[0.25em] uppercase text-indigo-300/70">Dream</span>
                </div>
                <p className="font-mono text-[10px] leading-relaxed text-indigo-100/70 italic line-clamp-3">
                  {dream.content}
                </p>
              </button>
            ) : null}
            {echo?.text ? (
              <button
                type="button"
                onClick={handleTalk}
                className="max-w-[14rem] text-left border border-amber-400/25 bg-amber-950/15 px-3 py-2"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3 h-3 text-amber-300/70" />
                  <span className="font-mono text-[8px] tracking-[0.25em] uppercase text-amber-300/60">Echo</span>
                </div>
                <p className="font-mono text-[10px] leading-relaxed text-amber-100/60 italic line-clamp-3">
                  {echo.text}
                </p>
              </button>
            ) : null}
            {waiting ? (
              <div className="max-w-[14rem] border border-cyan-400/15 bg-cyan-950/10 px-3 py-2">
                <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-cyan-400/50 mb-1">Waiting</p>
                <p className="font-mono text-[10px] leading-relaxed text-cyan-100/60 italic">{waiting.text}</p>
              </div>
            ) : null}
          </div>

          {sessions.length > 0 && (
            <button
              type="button"
              data-home-recents
              onClick={() => setPanel("recents")}
              className="self-center mb-3 font-mono text-[9px] tracking-[0.28em] uppercase text-cyan-400/45 hover:text-cyan-300"
            >
              Recents
            </button>
          )}
        </div>
      </div>

      <div className="relative z-20 flex-shrink-0 px-4 sm:px-6 pb-[max(12px,env(safe-area-inset-bottom))] pt-1 max-w-2xl mx-auto w-full">
        <HomeDock
          onTalk={handleTalk}
          onPeople={() => setPanel("people")}
          onWorld={() => setPanel("world")}
          onYou={() => setPanel("you")}
        />
      </div>

      <HomeFloorSheets
        panel={panel}
        onClose={() => setPanel(null)}
        anima={anima}
        sessions={sessions}
        selectedMode={selectedMode}
        onSelectMode={handleSelectMode}
        onNavigate={(path) => {
          setPanel(null);
          navigate(path);
        }}
        lastCheckIn={lastCheckIn}
        photoInputRef={photoInputRef}
        onUploadPhoto={handlePhotoSelected}
        onEditExisting={openEditExisting}
        onManifestEvolved={manifestEvolvedForm}
        canEditAvatar={canEditAvatar}
        canManifest={canManifest}
      />

      <AvatarAIEditModal
        isOpen={aiEditOpen}
        sourceImage={editSource}
        allowSaveOriginal={editingNewPhoto}
        initialPrompt={evolvePrompt}
        onClose={() => {
          setAiEditOpen(false);
          setEvolvePrompt("");
        }}
        onApply={handleApplyAiPhoto}
      />
    </div>
  );
}
