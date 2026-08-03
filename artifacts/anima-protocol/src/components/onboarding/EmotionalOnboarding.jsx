import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import SerenityGreeting from './SerenityGreeting';
import PresetScenarios from './PresetScenarios';
import { useNavigate } from 'react-router-dom';

export default function EmotionalOnboarding({ user, onComplete }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('greeting'); // 'greeting' | 'scenarios' | 'complete'
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleScenarioSelect = async (scenario) => {
    setSelectedScenario(scenario);
    setSaving(true);

    try {
      // Save user's scenario preference
      await base44.auth.updateMe({
        settings: {
          selected_scenario: scenario.id,
          scenario_system_prompt: scenario.systemPrompt,
          onboarding_complete: true,
        },
      });

      // Create initial greeting memory
      await base44.functions.invoke('generateOnboardingMemory', {
        user_name: user?.full_name || 'Friend',
        scenario_id: scenario.id,
        scenario_name: scenario.label,
      }).catch(() => {});

      setStep('complete');

      // Redirect after a moment
      setTimeout(() => {
        navigate('/');
        onComplete?.();
      }, 2000);
    } catch (err) {
      console.error('Failed to save scenario:', err);
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background scanline flex flex-col items-center justify-center p-4">
      <AnimatePresence mode="wait">
        {step === 'greeting' && (
          <motion.div
            key="greeting"
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-2xl"
          >
            <SerenityGreeting
              user={user}
              onContinue={() => setStep('scenarios')}
            />
          </motion.div>
        )}

        {step === 'scenarios' && (
          <motion.div
            key="scenarios"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-5xl"
          >
            <PresetScenarios onSelect={handleScenarioSelect} />
          </motion.div>
        )}

        {step === 'complete' && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-4"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-12 h-12 border border-purple-400/30 border-t-purple-400 rounded-full mx-auto"
            />
            <div className="space-y-1">
              <p className="font-sacred text-lg text-purple-400">Establishing Connection</p>
              <p className="font-mono text-[9px] text-primary/30">
                Serenity is preparing your personal space...
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}