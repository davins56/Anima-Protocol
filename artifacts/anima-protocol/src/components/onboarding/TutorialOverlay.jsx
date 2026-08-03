import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronRight, ChevronLeft, MessageSquare, Users, BookOpen,
  Sparkles, Heart, Feather, Zap, Brain, Map, Package, GitBranch
} from "lucide-react";

const STEPS = [
  {
    icon: MessageSquare,
    color: "text-cyan-400",
    borderColor: "border-cyan-400/40",
    bgColor: "bg-cyan-400/5",
    title: "Welcome to Serenity.AI",
    subtitle: "Your Immersive Story Universe",
    description:
      "Serenity is an interactive storytelling platform where you co-write living narratives with deeply personalised AI companions. Every conversation shapes a persistent, evolving world.",
    visual: "✦ Characters remember. Worlds breathe. Stories unfold. ✦",
  },
  {
    icon: MessageSquare,
    color: "text-primary",
    borderColor: "border-primary/40",
    bgColor: "bg-primary/5",
    title: "Chat — Your Story Begins Here",
    subtitle: "Solo & Group Modes",
    description:
      "Open a session with any character or a whole group. Type freely — your words steer the story. The AI stays fully in character, reacting authentically based on personality, backstory, and your relationship history.",
    tips: [
      "Solo mode: one-on-one immersive dialogue",
      "Group mode: multiple characters interact with each other",
      "Use *asterisks* for actions and stage directions",
    ],
  },
  {
    icon: Users,
    color: "text-purple-400",
    borderColor: "border-purple-400/40",
    bgColor: "bg-purple-400/5",
    title: "Characters & Animas",
    subtitle: "Build Your Cast",
    description:
      "Create original characters or browse pre-built companions. Animas are special archetypal beings with deeper emotional resonance. Each character has a unique voice, personality, backstory, and speaking style.",
    tips: [
      "Characters evolve through every interaction",
      "Animas connect to your emotional journey",
      "Assign ElevenLabs voices for audio immersion",
    ],
  },
  {
    icon: Brain,
    color: "text-pink-400",
    borderColor: "border-pink-400/40",
    bgColor: "bg-pink-400/5",
    title: "Memory & Relationships",
    subtitle: "Your Story Remembers",
    description:
      "Characters build real memories across sessions. Relationship scores shift from Hostile → Cold → Neutral → Warm → Close → Devoted based on how you interact. Cross-session memories ensure nothing is forgotten.",
    tips: [
      "Relationship tier affects how characters respond",
      "Recall past memories in the Memory Panel",
      "Characters reference earlier conversations naturally",
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
      "As you play, a persistent world builds around you — locations are logged, factions form, lore is extracted from your conversations. The World Pulse evolves the setting based on your emotional patterns.",
    tips: [
      "Lore keywords are auto-highlighted in messages",
      "Check the Wiki & Codex for world facts",
      "World evolves automatically every ~15 messages",
    ],
  },
  {
    icon: Package,
    color: "text-yellow-400",
    borderColor: "border-yellow-400/40",
    bgColor: "bg-yellow-400/5",
    title: "Quests, Inventory & Crafting",
    subtitle: "RPG Systems",
    description:
      "Narrative threads become quests automatically. Items mentioned in the story appear in your inventory. Equip gear, trade with characters, craft new items — all driven by the narrative.",
    tips: [
      "Quest log tracks objectives across sessions",
      "Inventory updates as the story progresses",
      "Items affect character stats and story hooks",
    ],
  },
  {
    icon: Feather,
    color: "text-blue-400",
    borderColor: "border-blue-400/40",
    bgColor: "bg-blue-400/5",
    title: "Chronicles & Journals",
    subtitle: "A Diary of Every Character",
    description:
      "Every day, each character reflects on recent events and writes a private journal entry — in their own voice, from their own perspective. Chronicles are compiled automatically every night.",
    tips: [
      "Browse Chronicles from the bottom nav",
      "Filter by character, tone, or date",
      'Hit "Compile Now" to generate today\'s entries',
    ],
  },
  {
    icon: Heart,
    color: "text-rose-400",
    borderColor: "border-rose-400/40",
    bgColor: "bg-rose-400/5",
    title: "Sacred Space & Check-ins",
    subtitle: "Your Inner World",
    description:
      "The Sacred Space tab offers meditations, affirmations, and a daily check-in ritual. Your emotional state influences the world — moods ripple into the narrative through the World Pulse system.",
    tips: [
      "Daily check-ins feed into the World Pulse",
      "Affirmations can be spoken with TTS",
      "Emotional climate shapes AI responses",
    ],
  },
  {
    icon: GitBranch,
    color: "text-orange-400",
    borderColor: "border-orange-400/40",
    bgColor: "bg-orange-400/5",
    title: "Branching, What-If & More",
    subtitle: "Advanced Story Tools",
    description:
      "Create timeline branches to explore alternate paths. Use What-If scenarios to replay key moments differently. The Scene Orchestrator lets you direct multi-character scenes with full control.",
    tips: [
      "Access tools via the ☰ menu in any session",
      "Story Flowchart maps your narrative arcs",
      "Export sessions as PDFs or story docs",
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
      "Everything is set up. Start a new session, pick a character, and let the story unfold. You can revisit this tutorial anytime from Settings.",
    visual: "✦ Your world is waiting ✦",
    isFinal: true,
  },
];

const STORAGE_KEY = "serenity_tutorial_seen_v1";

export default function TutorialOverlay({ onDone }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    onDone?.();
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  };

  const prev = () => setStep(s => Math.max(0, s - 1));

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
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        onClick={(e) => e.target === e.currentTarget && dismiss()}
      >
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.97 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={`w-full max-w-lg border ${current.borderColor} ${current.bgColor} bg-black/90 relative`}
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
              Skip Tutorial
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5">
            {/* Icon + Title */}
            <div className="flex items-start gap-4">
              <div className={`flex-shrink-0 w-10 h-10 border ${current.borderColor} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${current.color}`} />
              </div>
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
                  <div key={i} className="flex items-start gap-2 text-[10px] font-mono text-primary/55">
                    <span className={`${current.color} flex-shrink-0 mt-0.5`}>—</span>
                    <span>{tip}</span>
                  </div>
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