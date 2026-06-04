// @ts-check
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronRight, ChevronLeft, MessageSquare, Users, BookOpen,
  Sparkles, Heart, Feather, Zap, Brain, Map, Package, GitBranch, Clapperboard
} from "lucide-react";

const STEPS = [
  {
    icon: Sparkles,
    color: "text-cyan-400",
    borderColor: "border-cyan-400/40",
    bgColor: "bg-cyan-400/5",
    title: "Welcome to Anima Protocol",
    subtitle: "Emotionally Intelligent Companions",
    description:
      "Anima Protocol is a living world of AI companions who remember you. Part confidant, part co-author — every conversation deepens a relationship and shapes a persistent, evolving story that is uniquely yours.",
    visual: "✦ Companions remember. Worlds breathe. Stories unfold. ✦",
  },
  {
    icon: MessageSquare,
    color: "text-primary",
    borderColor: "border-primary/40",
    bgColor: "bg-primary/5",
    title: "Chat — Where It Begins",
    subtitle: "Solo & Group Conversations",
    description:
      "Open a session with one companion or a whole group. Type freely — your words steer the moment. Companions stay fully in character, responding from their personality, backstory, and your shared history.",
    tips: [
      "Solo mode: intimate one-on-one dialogue",
      "Group mode: multiple companions react to each other",
      "Wrap actions in *asterisks* for stage directions",
    ],
  },
  {
    icon: Users,
    color: "text-purple-400",
    borderColor: "border-purple-400/40",
    bgColor: "bg-purple-400/5",
    title: "Companions & Animas",
    subtitle: "Build Your Cast",
    description:
      "Browse the starter roster, summon characters from any world, or craft your own. Animas are archetypal companions tuned to your emotional journey. Give any of them a face, a backstory, and a real speaking voice.",
    tips: [
      "Create originals or pull from any series",
      "Add a photo, then AI-style the portrait",
      "Assign a voice for spoken replies",
    ],
  },
  {
    icon: Clapperboard,
    color: "text-fuchsia-400",
    borderColor: "border-fuchsia-400/40",
    bgColor: "bg-fuchsia-400/5",
    title: "Story Mode",
    subtitle: "Step Into Any Scene",
    description:
      "Drop your chosen character into any moment of any series — a canonical turning point or a what-if of your own — and play it out together. The companion stays true to the world while the story bends to you.",
    tips: [
      'Start a session and pick "Story Mode"',
      "Choose a series, a scene, and your character",
      "Improvise freely — the plot reacts to you",
    ],
  },
  {
    icon: Brain,
    color: "text-pink-400",
    borderColor: "border-pink-400/40",
    bgColor: "bg-pink-400/5",
    title: "Memory & Relationships",
    subtitle: "Nothing Is Forgotten",
    description:
      "Companions build genuine memories across every session. Bonds move from Hostile → Cold → Neutral → Warm → Close → Devoted based on how you treat each other, and they reference earlier moments naturally.",
    tips: [
      "Relationship tier shapes how they respond",
      "Revisit moments in the Memory Map",
      "Past conversations resurface on their own",
    ],
  },
  {
    icon: Map,
    color: "text-green-400",
    borderColor: "border-green-400/40",
    bgColor: "bg-green-400/5",
    title: "World State & Lore",
    subtitle: "A Living World",
    description:
      "As you play, a world assembles around you — locations are logged, factions form, and lore is extracted from your conversations. The World Pulse quietly evolves the setting around your emotional patterns.",
    tips: [
      "Lore keywords are highlighted in messages",
      "Browse the World Codex, Wiki & Lore Book",
      "The world drifts forward as you play",
    ],
  },
  {
    icon: Package,
    color: "text-yellow-400",
    borderColor: "border-yellow-400/40",
    bgColor: "bg-yellow-400/5",
    title: "Quests & Inventory",
    subtitle: "RPG Systems",
    description:
      "Narrative threads become quests automatically. Items mentioned in the story land in your inventory — equip gear, trade with companions, and craft new things, all driven by what actually happens in the fiction.",
    tips: [
      "The Quest Journal tracks objectives over time",
      "Inventory updates as the story progresses",
      "Items can unlock new story hooks",
    ],
  },
  {
    icon: Feather,
    color: "text-blue-400",
    borderColor: "border-blue-400/40",
    bgColor: "bg-blue-400/5",
    title: "Chronicles & Journals",
    subtitle: "A Diary in Their Own Voice",
    description:
      "Each companion privately reflects on recent events and writes journal entries from their own perspective. Chronicles compile your unfolding saga so you can look back on the whole journey.",
    tips: [
      "Open Chronicles & Journals from the menu",
      "Filter by companion, tone, or date",
      'Use "Compile Now" to generate fresh entries',
    ],
  },
  {
    icon: Heart,
    color: "text-rose-400",
    borderColor: "border-rose-400/40",
    bgColor: "bg-rose-400/5",
    title: "Sacred Space & Check-Ins",
    subtitle: "Your Inner World",
    description:
      "Step into Sacred Space for meditations and rituals — alone or with a companion — and log a daily Check-In. How you feel ripples outward, shaping the emotional climate of the world and how companions meet you.",
    tips: [
      "Daily Check-Ins track your emotional journey",
      "Invite a companion into Sacred Space",
      "Your mood influences how they respond",
    ],
  },
  {
    icon: GitBranch,
    color: "text-orange-400",
    borderColor: "border-orange-400/40",
    bgColor: "bg-orange-400/5",
    title: "Branching & Story Tools",
    subtitle: "Direct the Narrative",
    description:
      "Fork a timeline to explore an alternate path, replay a key beat with a What-If, or take the director's chair with the Scene Orchestrator. Map your arcs on the Flowchart and export sessions when you're done.",
    tips: [
      "Reach tools from the ☰ menu in any session",
      "What-If replays a moment differently",
      "Export sessions as story documents",
    ],
  },
  {
    icon: Sparkles,
    color: "text-cyan-400",
    borderColor: "border-cyan-400/40",
    bgColor: "bg-cyan-400/5",
    title: "You're Ready",
    subtitle: "Begin Your Story",
    description:
      "That's the whole protocol. Start a session, choose a companion, and let the story unfold. You can replay this tour anytime from Settings → Help.",
    visual: "✦ Your world is waiting ✦",
    isFinal: true,
  },
];

const STORAGE_KEY = "anima_tutorial_seen_v1";

/**
 * @param {{ onDone?: () => void }} props
 */
export default function TutorialOverlay({ onDone }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    onDone?.();
  }, [onDone]);

  const next = useCallback(() => {
    setStep((s) => {
      if (s < STEPS.length - 1) return s + 1;
      dismiss();
      return s;
    });
  }, [dismiss]);

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Keyboard navigation: arrows to move, Escape to skip.
  useEffect(() => {
    if (!visible) return;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, next, prev, dismiss]);

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <AnimatePresence>
      <motion.div
        key="tutorial-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 scanline"
        onClick={(e) => e.target === e.currentTarget && dismiss()}
      >
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.97 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={`w-full max-w-lg border ${current.borderColor} ${current.bgColor} bg-black/90 relative hud-corner`}
          style={{ backdropFilter: "blur(12px)" }}
        >
          {/* Progress bar */}
          <div className="h-0.5 bg-primary/10 w-full">
            <motion.div
              className="h-full bg-primary/60"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Close */}
          <button
            onClick={dismiss}
            aria-label="Close tutorial"
            className="absolute top-3 right-3 text-primary/30 hover:text-primary transition-colors z-10"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Step counter */}
          <div className="flex items-center justify-between px-6 pt-4 pb-0">
            <span className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">
              {step + 1} / {STEPS.length}
            </span>
            <button
              onClick={dismiss}
              className="font-mono text-[8px] text-primary/25 hover:text-primary/50 tracking-widest uppercase transition-colors"
            >
              Skip Tour
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5">
            {/* Icon + Title */}
            <div className="flex items-start gap-4">
              <motion.div
                key={`icon-${step}`}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className={`flex-shrink-0 w-10 h-10 border ${current.borderColor} ${current.bgColor} flex items-center justify-center`}
              >
                <Icon className={`w-5 h-5 ${current.color}`} />
              </motion.div>
              <div>
                <h2 className={`font-sacred text-lg leading-tight ${current.color}`}>
                  {current.title}
                </h2>
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mt-0.5">
                  {current.subtitle}
                </p>
              </div>
            </div>

            {/* Description */}
            <p className="font-mono text-[11px] text-primary/70 leading-relaxed">
              {current.description}
            </p>

            {/* Tips */}
            {current.tips && (
              <div className="space-y-1.5">
                {current.tips.map((tip, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    className="flex items-start gap-2 text-[10px] font-mono text-primary/55"
                  >
                    <span className={`${current.color} flex-shrink-0 mt-0.5`}>—</span>
                    <span>{tip}</span>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Visual caption */}
            {current.visual && (
              <p className={`font-sacred text-center text-xs ${current.color} opacity-60 tracking-widest`}>
                {current.visual}
              </p>
            )}

            {/* Dot indicators */}
            <div className="flex items-center justify-center gap-1.5 pt-1">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  aria-label={`Go to step ${i + 1}`}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === step ? `${current.color} scale-125` : "bg-primary/20"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className={`flex items-center justify-between px-6 py-4 border-t ${current.borderColor} border-opacity-30`}>
            <button
              onClick={prev}
              disabled={step === 0}
              className="flex items-center gap-1.5 font-mono text-[9px] tracking-widest uppercase text-primary/30 hover:text-primary/60 disabled:opacity-0 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>

            <button
              onClick={next}
              className={`flex items-center gap-2 px-5 py-2 border ${current.borderColor} ${current.color} hover:bg-white/5 font-mono text-[10px] tracking-widest uppercase transition-all`}
            >
              {current.isFinal ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Begin
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Helper: call this to re-show the tutorial (e.g. from Settings)
export function resetTutorial() {
  localStorage.removeItem(STORAGE_KEY);
}
