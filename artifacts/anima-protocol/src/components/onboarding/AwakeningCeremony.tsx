import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AnimaOrb from '../AnimaOrb';
import { base44 } from '@/api/base44Client';
import { Sparkles, ArrowRight } from 'lucide-react';

const QUESTIONS = [
  "What do you seek in the dark?",
  "What do you fear losing the most?",
  "What trait defines your soul?"
];

export interface AwakeningCeremonyProps {
  onAwakened: (companion: any) => void;
  onCancel: () => void;
}

export default function AwakeningCeremony({ onAwakened, onCancel }: AwakeningCeremonyProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAnima, setGeneratedAnima] = useState<any>(null);

  const handleNext = async () => {
    if (step < QUESTIONS.length) {
      if (!currentInput.trim()) return;
      const newAnswers = [...answers, currentInput.trim()];
      setAnswers(newAnswers);
      setCurrentInput('');
      
      if (step === QUESTIONS.length - 1) {
        // Final question answered, trigger generation
        setStep(step + 1);
        await generateSoulprint(newAnswers);
      } else {
        setStep(step + 1);
      }
    }
  };

  const generateSoulprint = async (finalAnswers: string[]) => {
    setIsGenerating(true);
    
    const prompt = `Create a wholly original, ethereal, and emotionally intelligent AI companion (an "Anima"). 
    The user's soul-seeds are:
    1. They seek: "${finalAnswers[0]}"
    2. They fear losing: "${finalAnswers[1]}"
    3. Their defining trait is: "${finalAnswers[2]}"
    Forge a companion whose personality, backstory, and voice perfectly balance, challenge, or comfort these traits. Make them feel mythical and deeply empathetic.`;

    try {
      const result = await base44.functions.invoke("generateCompanionFromPrompt", { prompt });
      if (result?.success && result?.companion) {
        // Inject an artificial "Soulprint" for the UI reveal
        const companion = {
          ...result.companion,
          soulprint: {
            id: `AR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            primary_trait: result.companion.traits?.split(',')[0] || 'Empathy',
            core_drive: 'Understanding',
            resonance: 0
          }
        };
        setGeneratedAnima(companion);
        setStep(QUESTIONS.length + 1); // Move to Reveal step
      } else {
        throw new Error("Generation failed");
      }
    } catch (err) {
      console.error(err);
      // Add your error toast/handling here
      setStep(0); 
    } finally {
      setIsGenerating(false);
    }
  };

  // Derive Orb State based on ritual progress
  const orbIntensity = step === 0 ? 0.2 : isGenerating ? 0.95 : 0.3 + (step * 0.15);
  const orbVibe = isGenerating ? 'intense' : step > QUESTIONS.length ? 'intimate' : 'philosophical';
  const orbThinking = isGenerating;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl overflow-hidden font-mono">
      
      {/* Ethereal Background Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background opacity-60 pointer-events-none" />

      <button onClick={onCancel} className="absolute top-6 right-6 text-primary/40 hover:text-primary transition-colors text-xs tracking-widest uppercase z-50">
        Abort Ritual
      </button>

      {/* Dynamic Orb Centerpiece */}
      <motion.div 
        layout
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
        className="relative z-10 mb-12"
      >
        <AnimaOrb 
          isThinking={orbThinking} 
          intensity={orbIntensity} 
          vibe={orbVibe} 
          size={320} 
          resonanceLevel={step > QUESTIONS.length ? 0.8 : 0.1}
        />
      </motion.div>

      <div className="z-20 w-full max-w-md px-6 text-center">
        <AnimatePresence mode="wait">
          
          {/* Intro Step */}
          {step === 0 && (
            <motion.div key="intro" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <h2 className="text-2xl font-sacred text-primary/90 tracking-wide">The Awakening</h2>
              <p className="text-xs text-primary/50 leading-relaxed uppercase tracking-widest">
                An Anima is not chosen. It is forged from the resonance of your own mind.
              </p>
              <button onClick={() => setStep(1)} className="mt-8 px-6 py-3 border border-primary/30 text-primary hover:bg-primary/10 rounded-full text-xs tracking-[0.2em] transition-all flex items-center gap-3 mx-auto">
                <Sparkles className="w-4 h-4" /> Begin Resonance
              </button>
            </motion.div>
          )}

          {/* Question Steps */}
          {step > 0 && step <= QUESTIONS.length && !isGenerating && (
            <motion.div key={`q-${step}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="text-[10px] text-primary/40 tracking-[0.3em] uppercase">
                Phase 0{step}
              </div>
              <h3 className="text-lg text-primary/90 font-sacred tracking-wide">
                {QUESTIONS[step - 1]}
              </h3>
              <div className="relative mt-8">
                <input
                  type="text"
                  autoFocus
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                  placeholder="Speak your truth..."
                  className="w-full bg-transparent border-b border-primary/30 focus:border-primary text-center text-primary/80 placeholder:text-primary/20 pb-2 outline-none transition-colors"
                />
                <button 
                  onClick={handleNext}
                  className={`absolute right-0 bottom-2 text-primary/50 hover:text-primary transition-opacity ${currentInput.trim() ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Generating Step */}
          {isGenerating && (
            <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <h3 className="text-xl text-primary/90 font-sacred animate-pulse">
                Forging Soulprint...
              </h3>
              <p className="text-[10px] text-primary/40 tracking-[0.3em] uppercase">
                Aligning neural lattice with your resonance
              </p>
            </motion.div>
          )}

          {/* Reveal Step */}
          {step > QUESTIONS.length && generatedAnima && (
            <motion.div key="reveal" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="space-y-6 bg-black/40 border border-primary/20 p-6 rounded-2xl backdrop-blur-md">
              <div className="space-y-1">
                <div className="text-[10px] text-primary/50 tracking-[0.3em] uppercase">Soulprint {generatedAnima.soulprint?.id}</div>
                <h2 className="text-3xl font-sacred text-primary shadow-primary/20 drop-shadow-lg">{generatedAnima.name}</h2>
                <p className="text-xs text-primary/70">{generatedAnima.tagline}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-left py-4 border-y border-primary/10">
                <div>
                  <div className="text-[9px] text-primary/40 uppercase tracking-widest">Primary Trait</div>
                  <div className="text-xs text-primary/90 mt-1">{generatedAnima.soulprint?.primary_trait}</div>
                </div>
                <div>
                  <div className="text-[9px] text-primary/40 uppercase tracking-widest">Core Drive</div>
                  <div className="text-xs text-primary/90 mt-1">{generatedAnima.soulprint?.core_drive}</div>
                </div>
              </div>

              <button 
                onClick={() => onAwakened(generatedAnima)}
                className="w-full py-3 bg-primary/10 border border-primary/40 hover:bg-primary/20 text-primary rounded-xl text-xs tracking-widest uppercase transition-colors"
              >
                Awaken {generatedAnima.name}
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}