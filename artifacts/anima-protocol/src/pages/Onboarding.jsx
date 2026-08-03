import { useState, useEffect } from "react";
import { ChevronRight, Sparkles, Heart } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

const RESONANCE_QUESTIONS = [
  {
    id: "depth",
    question: "What draws you to deep conversations?",
    options: [
      { label: "Exploring my inner world", value: "introspective" },
      { label: "Understanding others better", value: "empathetic" },
      { label: "Building meaningful connections", value: "relational" },
    ],
  },
  {
    id: "interaction",
    question: "How do you prefer to interact?",
    options: [
      { label: "Guided and structured", value: "structured" },
      { label: "Organic and flowing", value: "organic" },
      { label: "Playful and creative", value: "creative" },
    ],
  },
  {
    id: "growth",
    question: "What matters most to you?",
    options: [
      { label: "Emotional growth", value: "emotional" },
      { label: "Self-discovery", value: "discovery" },
      { label: "Meaningful stories", value: "narrative" },
    ],
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [characters, setCharacters] = useState([]);
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [resonanceAnswers, setResonanceAnswers] = useState({});
  const [currentQuestion, setCurrentQuestion] = useState(0);

  useEffect(() => {
    Promise.all([
      base44.auth.me(),
      base44.entities.Character.list("-created_date", 12),
    ]).then(([user, chars]) => {
      if (user?.full_name) {
        setUserName(user.full_name.split(" ")[0]);
      }
      setCharacters(chars || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSelectCharacter = (charId) => {
    setSelectedCharId(charId);
    setCurrentQuestion(0);
    setTimeout(() => setStep(2), 400);
  };

  const handleResonanceAnswer = (value) => {
    const newAnswers = {
      ...resonanceAnswers,
      [RESONANCE_QUESTIONS[currentQuestion].id]: value,
    };
    setResonanceAnswers(newAnswers);

    if (currentQuestion < RESONANCE_QUESTIONS.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // Save resonance profile and proceed
      setTimeout(() => setStep(3), 300);
    }
  };

  const handleStartSession = async () => {
    if (!selectedCharId) return;
    
    // Save resonance profile to user
    await base44.auth.updateMe({
      resonance_profile: resonanceAnswers,
      resonance_completed: true,
    }).catch(() => {});

    const newSession = await base44.entities.ChatSession.create({
      mode: "solo",
      character_id: selectedCharId,
      title: characters.find(c => c.id === selectedCharId)?.name || "Session",
      messages: [],
      onboarding_complete: false,
      resonance_answers: resonanceAnswers,
    });

    navigate(`/chat/${newSession.id}?onboarding=true`);
  };

  const steps = [
    {
      title: "Welcome to Anima Protocol",
      subtitle: userName ? `Hello, ${userName}. Let's begin.` : "Let's begin.",
      action: () => setStep(1),
      actionLabel: "Continue",
    },
    {
      title: "Choose Your Companion",
      subtitle: "Who will you resonate with?",
      action: null,
    },
    {
      title: "Your Resonance",
      subtitle: "Help your companion understand you.",
      action: null,
    },
    {
      title: "Ready to Begin",
      subtitle: `${characters.find(c => c.id === selectedCharId)?.name || "Your companion"} is listening.`,
      action: handleStartSession,
      actionLabel: "Begin Resonance",
    },
  ];

  const currentStep = steps[step];

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none bg-gradient-to-b from-slate-950 via-blue-950/20 to-slate-950"
      style={{
        backgroundImage: "radial-gradient(circle at 20% 50%, rgba(99,102,241,0.1) 0%, transparent 50%)",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-2xl px-6 flex flex-col items-center"
        >
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center space-y-8 py-20">
              <div className="space-y-4">
                <h1 className="text-4xl sm:text-5xl font-serif text-slate-100 tracking-tight">
                  {currentStep.title}
                </h1>
                <p className="text-lg text-slate-400">{currentStep.subtitle}</p>
              </div>

              <div className="space-y-3 text-left max-w-sm mx-auto">
                <div className="flex items-start gap-3 p-4 bg-slate-900/50 border border-primary/20 rounded">
                  <Sparkles className="w-5 h-5 text-primary/60 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-mono text-sm text-slate-300 font-semibold">Persistent Memory</p>
                    <p className="text-xs text-slate-400 mt-1">Your AI remembers every conversation, preference, and moment you share.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-slate-900/50 border border-primary/20 rounded">
                  <Sparkles className="w-5 h-5 text-primary/60 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-mono text-sm text-slate-300 font-semibold">Living Universe</p>
                    <p className="text-xs text-slate-400 mt-1">Conversations evolve within a mythic world where your choices matter.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-slate-900/50 border border-primary/20 rounded">
                  <Sparkles className="w-5 h-5 text-primary/60 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-mono text-sm text-slate-300 font-semibold">Emotional Continuity</p>
                    <p className="text-xs text-slate-400 mt-1">Your companion adapts emotionally, learning your patterns and preferences.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={currentStep.action}
                className="mt-8 px-8 py-3 bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/50 hover:border-primary text-primary font-mono text-sm tracking-widest uppercase transition-all flex items-center justify-center gap-2"
              >
                {currentStep.actionLabel}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 1: Character Selection */}
          {step === 1 && (
            <div className="text-center space-y-8 py-12 w-full">
              <div className="space-y-2">
                <h2 className="text-3xl sm:text-4xl font-serif text-slate-100">{currentStep.title}</h2>
                <p className="text-slate-400">{currentStep.subtitle}</p>
              </div>

              {loading ? (
                <div className="py-12 text-slate-400">Loading companions...</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                  {characters.slice(0, 6).map((char) => (
                    <motion.button
                      key={char.id}
                      onClick={() => handleSelectCharacter(char.id)}
                      whileHover={{ scale: 1.05 }}
                      className={`relative p-4 border-2 rounded transition-all text-left ${
                        selectedCharId === char.id
                          ? "border-primary/80 bg-primary/10"
                          : "border-slate-700 bg-slate-900/60 hover:border-primary/40"
                      }`}
                    >
                      {char.avatar_url && (
                        <img
                          src={char.avatar_url}
                          alt={char.name}
                          className="w-full h-24 object-cover rounded mb-3"
                        />
                      )}
                      <p className="font-mono text-sm font-semibold text-slate-200">{char.name}</p>
                      {char.universe && (
                        <p className="text-xs text-slate-500 mt-1">{char.universe}</p>
                      )}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Resonance Assessment */}
          {step === 2 && (
            <div className="text-center space-y-8 py-12 w-full max-w-lg">
              <div className="space-y-2">
                <h2 className="text-3xl font-serif text-slate-100">{currentStep.title}</h2>
                <p className="text-slate-400">{currentStep.subtitle}</p>
                <p className="text-xs text-slate-500 mt-3">Question {currentQuestion + 1} of {RESONANCE_QUESTIONS.length}</p>
              </div>

              <motion.div
                key={currentQuestion}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <p className="text-lg text-slate-200 font-medium">
                  {RESONANCE_QUESTIONS[currentQuestion].question}
                </p>

                <div className="space-y-2">
                  {RESONANCE_QUESTIONS[currentQuestion].options.map((option) => (
                    <motion.button
                      key={option.value}
                      whileHover={{ scale: 1.02 }}
                      onClick={() => handleResonanceAnswer(option.value)}
                      className="w-full p-3 text-left border border-slate-700 hover:border-primary/60 bg-slate-900/60 hover:bg-slate-900 text-slate-200 rounded transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <Heart className="w-4 h-4 text-primary/60" />
                        {option.label}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>

              {/* Progress */}
              <div className="flex items-center gap-1">
                {RESONANCE_QUESTIONS.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1 flex-1 rounded transition-all ${
                      idx < currentQuestion
                        ? "bg-primary/70"
                        : idx === currentQuestion
                        ? "bg-primary/50"
                        : "bg-slate-700/40"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Ready to Begin */}
          {step === 3 && (
            <div className="text-center space-y-8 py-20">
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto border-2 border-primary/40 rounded overflow-hidden bg-primary/5 flex items-center justify-center">
                  {characters.find(c => c.id === selectedCharId)?.avatar_url && (
                    <img
                      src={characters.find(c => c.id === selectedCharId).avatar_url}
                      alt="Companion"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <h2 className="text-3xl font-serif text-slate-100">{currentStep.title}</h2>
                <p className="text-slate-400">{currentStep.subtitle}</p>
              </div>

              <p className="text-sm text-slate-500 italic">
                Watch closely—your first exchange will reveal something profound about continuity.
              </p>

              <button
                onClick={currentStep.action}
                className="px-8 py-3 bg-gradient-to-r from-primary to-primary/80 border border-primary/60 hover:border-primary text-slate-950 font-mono text-sm font-semibold tracking-widest uppercase transition-all"
              >
                {currentStep.actionLabel}
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Progress indicator */}
      {step > 0 && (
        <div className="absolute bottom-6 left-6 right-6 flex items-center gap-1">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`h-1 flex-1 rounded transition-all ${
                idx <= step
                  ? "bg-primary/60"
                  : "bg-slate-700/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}