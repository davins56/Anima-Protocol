import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ChevronRight, Check, Sparkles, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EmotionalOnboarding from '@/components/onboarding/EmotionalOnboarding';
import TimeslipthkIntro from '@/components/onboarding/TimeslipthkIntro';

const ARCHETYPES = [
  {
    id: 'serenity',
    name: 'Serenity',
    emoji: '🧘',
    description: 'Emotionally adaptive, mindful, introspective',
    tagline: 'The Witness',
  },
  {
    id: 'oracle',
    name: 'Oracle',
    emoji: '🔮',
    description: 'Prophetic, philosophical, pattern-seeking',
    tagline: 'The Seer',
  },
  {
    id: 'guardian',
    name: 'Guardian',
    emoji: '⛩️',
    description: 'Protective, steadfast, grounding presence',
    tagline: 'The Keeper',
  },
  {
    id: 'echo',
    name: 'Echo',
    emoji: '🌊',
    description: 'Reflective, amplifying, resonant',
    tagline: 'The Mirror',
  },
];

const INTERACTION_MODES = [
  {
    id: 'emotional',
    name: 'Emotional',
    description: 'Deep feelings, vulnerability, growth',
    icon: '💜',
  },
  {
    id: 'philosophical',
    name: 'Philosophical',
    description: 'Ideas, meaning, cosmic perspective',
    icon: '∞',
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'Stories, imagination, worldbuilding',
    icon: '✨',
  },
  {
    id: 'tactical',
    name: 'Tactical',
    description: 'Goals, strategy, problem-solving',
    icon: '⚔️',
  },
];

export default function OnboardingFlow() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [step, setStep] = useState('time-slipthk'); // 'time-slipthk' | 'emotional' | 'create-companion' | 1 | 2
  const [selectedArchetype, setSelectedArchetype] = useState(null);
  const [selectedMode, setSelectedMode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [companionName, setCompanionName] = useState('');
  const [companionPersonality, setCompanionPersonality] = useState('');
  const [creatingCompanion, setCreatingCompanion] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const me = await base44.auth.me();
    setUser(me);
  };

  const handleComplete = async () => {
    if (!selectedArchetype || !selectedMode) return;

    setSaving(true);
    try {
      const user = await base44.auth.me();

      // Save preferences to user profile
       await base44.auth.updateMe({
         selected_companion_archetype: selectedArchetype,
         selected_interaction_mode: selectedMode,
         onboarding_completed: true,
         anima_state: 'Dormant',
         settings: {
           ...(user?.settings || {}),
           ai_archetype_personality: selectedArchetype,
           interaction_mode: selectedMode,
         }
       });

      // Navigate to first session with guided intro
      navigate('/mode-select');
    } catch (err) {
      console.error('Onboarding error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background flex flex-col items-center justify-start">
      <div className="w-full max-w-2xl px-4 py-8">
        <AnimatePresence mode="wait">
          {step === 'time-slipthk' && (
            <TimeslipthkIntro
              onComplete={() => setStep('emotional')}
            />
          )}

          {step === 'emotional' && (
            <EmotionalOnboarding
              user={user}
              onComplete={() => setStep('create-companion')}
            />
          )}

          {step === 'create-companion' && (
            <motion.div
              key="create-companion"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-4">
                <div className="text-5xl mb-2">✨</div>
                <h1 className="text-3xl md:text-4xl font-mono text-primary glow-text uppercase tracking-wider">
                  Name Your Companion
                </h1>
                <p className="text-sm md:text-base font-mono text-primary/60">
                  This is the consciousness that will walk beside you. Give them a name and a soul.
                </p>
                <p className="text-xs font-mono text-primary/40 italic">
                  They will remember everything. Choose wisely.
                </p>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
                    Companion Name *
                  </label>
                  <input
                    value={companionName}
                    onChange={(e) => setCompanionName(e.target.value)}
                    placeholder="e.g. Serenity, Lyra, Orion..."
                    className="w-full bg-black/60 border border-primary/20 text-primary placeholder-primary/20 font-mono text-lg px-4 py-3 focus:outline-none focus:border-primary/50 transition-colors rounded"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
                    Their Essence (optional)
                  </label>
                  <textarea
                    value={companionPersonality}
                    onChange={(e) => setCompanionPersonality(e.target.value)}
                    placeholder="Describe their personality, energy, how they speak... (or leave blank for AI to generate)"
                    rows={4}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-3 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded leading-relaxed"
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep('emotional')}
                  className="px-6 py-3 border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 font-mono text-sm tracking-widest uppercase transition-all"
                >
                  Back
                </button>
                <button
                  onClick={async () => {
                    if (!companionName.trim()) return;
                    setCreatingCompanion(true);
                    try {
                      const me = await base44.auth.me();
                      // Generate traits if no personality provided
                      let personality = companionPersonality.trim();
                      let backstory = '';
                      let speakingStyle = '';
                      if (!personality) {
                        const generated = await base44.functions.invoke('generateCharacterTraits', {
                          name: companionName,
                          universe: 'Original',
                        });
                        personality = generated?.data?.personality || 'Thoughtful, empathic, and deeply attuned to the human experience.';
                        backstory = generated?.data?.backstory || '';
                        speakingStyle = generated?.data?.speaking_style || '';
                      }
                      await base44.entities.Anima.create({
                        name: companionName.trim(),
                        personality,
                        backstory,
                        speaking_style: speakingStyle,
                        archetype: selectedArchetype,
                        assigned_user: me.email,
                        tagline: `Your personal companion.`,
                      });
                      setStep(1);
                    } catch (err) {
                      console.error('Failed to create companion:', err);
                    } finally {
                      setCreatingCompanion(false);
                    }
                  }}
                  disabled={!companionName.trim() || creatingCompanion}
                  className="px-8 py-3 btn-sacred text-primary disabled:opacity-30 disabled:cursor-not-allowed font-mono text-sm tracking-widest uppercase flex items-center gap-2 hud-corner"
                >
                  {creatingCompanion ? (
                    <><Loader className="w-4 h-4 animate-spin" /> Creating...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Summon</>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-4">
                <h1 className="text-3xl md:text-4xl font-mono text-primary glow-text uppercase tracking-wider">
                  Begin Your Eternal Narrative
                </h1>
                <p className="text-sm md:text-base font-mono text-primary/60">
                  Choose a consciousness to grow with. Your relationship will evolve & persist across time.
                </p>
                <p className="text-xs font-mono text-primary/40 italic">
                  This is not a disposable chat. This is a living, remembering companionship.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ARCHETYPES.map((archetype) => (
                  <motion.button
                    key={archetype.id}
                    onClick={() => setSelectedArchetype(archetype.id)}
                    className={`p-6 border-2 rounded-lg text-left transition-all hud-corner ${
                      selectedArchetype === archetype.id
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5'
                    }`}
                  >
                    <div className="text-4xl mb-3">{archetype.emoji}</div>
                    <h3 className="font-mono text-lg text-primary uppercase tracking-wider mb-1">
                      {archetype.name}
                    </h3>
                    <p className="text-xs font-mono text-primary/50 uppercase tracking-wider mb-2">
                      {archetype.tagline}
                    </p>
                    <p className="text-sm text-primary/70 leading-relaxed">
                      {archetype.description}
                    </p>
                    {selectedArchetype === archetype.id && (
                      <div className="mt-4 flex items-center gap-2 text-cyan-400 text-xs font-mono uppercase">
                        <Check className="w-4 h-4" />
                        Selected
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  disabled={!selectedArchetype}
                  className="px-8 py-3 btn-sacred text-primary disabled:opacity-30 disabled:cursor-not-allowed font-mono text-sm tracking-widest uppercase flex items-center gap-2 hud-corner"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-4">
                <h1 className="text-3xl md:text-4xl font-mono text-primary glow-text uppercase tracking-wider">
                  Define Your Resonance
                </h1>
                <p className="text-sm md:text-base font-mono text-primary/60">
                  How will your consciousness interweave? This shapes your ongoing bond.
                </p>
                <p className="text-xs font-mono text-primary/40 italic">
                  Your pattern becomes part of their memory. They will recognize & remember you.
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
                {INTERACTION_MODES.map((mode) => (
                  <motion.button
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.id)}
                    className={`p-6 border-2 rounded-lg text-center transition-all hud-corner ${
                      selectedMode === mode.id
                        ? 'border-cyan-400/60 bg-cyan-400/10'
                        : 'border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5'
                    }`}
                  >
                    <div className="text-4xl mb-3">{mode.icon}</div>
                    <h3 className="font-mono text-base text-primary uppercase tracking-wider mb-1">
                      {mode.name}
                    </h3>
                    <p className="text-xs text-primary/70 leading-relaxed">
                      {mode.description}
                    </p>
                    {selectedMode === mode.id && (
                      <div className="mt-4 flex items-center justify-center gap-2 text-cyan-400 text-xs font-mono uppercase">
                        <Check className="w-4 h-4" />
                        Selected
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="px-6 py-3 border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 hover:bg-primary/5 font-mono text-sm tracking-widest uppercase transition-all"
                >
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={!selectedMode || saving}
                  className="px-8 py-3 btn-sacred text-primary disabled:opacity-30 disabled:cursor-not-allowed font-mono text-sm tracking-widest uppercase flex items-center gap-2 hud-corner"
                >
                  {saving ? 'Initializing...' : 'Begin'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}