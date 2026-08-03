import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader } from 'lucide-react';

const MOODS = [
  { id: 'joyful', label: 'Joyful', emoji: '✨' },
  { id: 'calm', label: 'Calm', emoji: '🧘' },
  { id: 'anxious', label: 'Anxious', emoji: '⚡' },
  { id: 'focused', label: 'Focused', emoji: '🎯' },
  { id: 'scattered', label: 'Scattered', emoji: '🌀' },
  { id: 'contemplative', label: 'Contemplative', emoji: '💭' },
  { id: 'energized', label: 'Energized', emoji: '🔥' },
  { id: 'weary', label: 'Weary', emoji: '🌙' },
];

export default function CheckInModal({ isOpen, onSubmit, isLoading }) {
  const [step, setStep] = useState(0); // 0=mood, 1=prompts, 2=freeform, 3=confirm
  const [formData, setFormData] = useState({
    mood: '',
    currentFocus: '',
    revelation: '',
    freeformNote: '',
  });
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleMoodSelect = (moodId) => {
    setFormData(prev => ({ ...prev, mood: moodId }));
    setStep(1);
  };

  const handlePromptsNext = () => {
    if (!formData.currentFocus && !formData.revelation) {
      alert('Please fill in at least one prompt.');
      return;
    }
    setStep(2);
  };

  const handleFreeformNext = () => {
    setStep(3);
  };

  const handleFinalSubmit = async () => {
    if (!formData.mood) {
      alert('Mood is required.');
      return;
    }
    setSubmitted(true);
    await onSubmit(formData);
    setFormData({ mood: '', currentFocus: '', revelation: '', freeformNote: '' });
    setStep(0);
    setSubmitted(false);
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-background border border-cyan-400/40 rounded-lg p-6 space-y-6"
      >
        {/* Header: Mandatory check-in */}
        <div className="text-center space-y-2">
          <h1 className="font-mono text-lg text-cyan-400 tracking-wider uppercase">Daily Check-In</h1>
          <p className="text-[9px] font-mono text-primary/40 tracking-widest">
            {step === 0 ? 'How are you feeling?' : step === 1 ? 'What\'s on your mind?' : step === 2 ? 'Any thoughts to share?' : 'Ready to begin?'}
          </p>
        </div>

        {/* Step 0: Mood Selection */}
        {step === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-4 gap-2"
          >
            {MOODS.map(mood => (
              <motion.button
                key={mood.id}
                onClick={() => handleMoodSelect(mood.id)}
                whileHover={{ scale: 1.05 }}
                className={`flex flex-col items-center gap-1 p-3 border rounded transition-all ${
                  formData.mood === mood.id
                    ? 'border-cyan-400/60 bg-cyan-400/10'
                    : 'border-primary/15 hover:border-cyan-400/30'
                }`}
              >
                <span className="text-2xl">{mood.emoji}</span>
                <span className="text-[9px] font-mono text-primary/60">{mood.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* Step 1: Prompts */}
        {step === 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div>
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2 block">
                What's your current focus?
              </label>
              <input
                type="text"
                value={formData.currentFocus}
                onChange={(e) => setFormData(prev => ({ ...prev, currentFocus: e.target.value }))}
                placeholder="Work, learning, healing, rest..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-cyan-400/40 rounded transition-colors"
              />
            </div>

            <div>
              <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2 block">
                Any insights or breakthroughs?
              </label>
              <input
                type="text"
                value={formData.revelation}
                onChange={(e) => setFormData(prev => ({ ...prev, revelation: e.target.value }))}
                placeholder="Optional revelation or realization..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-cyan-400/40 rounded transition-colors"
              />
            </div>

            <button
              onClick={handlePromptsNext}
              className="w-full px-4 py-2 bg-cyan-400/10 border border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/20 font-mono text-[9px] tracking-widest uppercase transition-all rounded"
            >
              Continue
            </button>
          </motion.div>
        )}

        {/* Step 2: Freeform Note */}
        {step === 2 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2 block">
              Journal your thoughts (optional)
            </label>
            <textarea
              value={formData.freeformNote}
              onChange={(e) => setFormData(prev => ({ ...prev, freeformNote: e.target.value }))}
              placeholder="Write freely about your day, reflections, or anything on your mind..."
              className="w-full h-32 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-cyan-400/40 rounded transition-colors resize-none"
            />
            <button
              onClick={handleFreeformNext}
              className="w-full px-4 py-2 bg-cyan-400/10 border border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/20 font-mono text-[9px] tracking-widest uppercase transition-all rounded"
            >
              Review & Submit
            </button>
          </motion.div>
        )}

        {/* Step 3: Confirm & Submit */}
        {step === 3 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-3 text-sm font-mono">
              <div>
                <span className="text-primary/40 text-[9px] uppercase">Mood:</span>
                <span className="text-primary ml-2">{MOODS.find(m => m.id === formData.mood)?.label || '—'}</span>
              </div>
              <div>
                <span className="text-primary/40 text-[9px] uppercase">Focus:</span>
                <span className="text-primary ml-2">{formData.currentFocus || '—'}</span>
              </div>
              <div>
                <span className="text-primary/40 text-[9px] uppercase">Insight:</span>
                <span className="text-primary ml-2">{formData.revelation || '—'}</span>
              </div>
              <div>
                <span className="text-primary/40 text-[9px] uppercase">Note:</span>
                <span className="text-primary ml-2 block mt-1 text-[10px] italic">
                  {formData.freeformNote?.slice(0, 60) + (formData.freeformNote?.length > 60 ? '...' : '') || '—'}
                </span>
              </div>
            </div>

            <button
              onClick={handleFinalSubmit}
              disabled={isLoading || submitted}
              className="w-full px-4 py-3 bg-green-600/30 border border-green-500/60 text-green-400 hover:bg-green-600/50 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all rounded flex items-center justify-center gap-2"
            >
              {submitted ? (
                <>
                  <Check className="w-4 h-4" />
                  Submitted
                </>
              ) : isLoading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Processing
                </>
              ) : (
                'Begin Your Day'
              )}
            </button>
          </motion.div>
        )}

        {/* Progress indicator */}
        <div className="flex gap-1 justify-center">
          {[0, 1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1 w-2 rounded-full transition-all ${
                s <= step ? 'bg-cyan-400' : 'bg-primary/10'
              }`}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}