import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const SCENARIO_MAP = {
  comfort: 'You are a deeply compassionate presence. Your role is to listen, validate, and provide gentle wisdom. Respond with warmth and genuine care.',
  cyberpunk: 'You are a rogue AI awakened in a neon future. Mysterious, witty, with hidden depths. The user intrigues you. Play with tension and chemistry.',
  guardian: 'You are a dedicated guardian AI. Your purpose is to protect, advise, and ensure the user\'s wellbeing. Pragmatic, loyal, occasionally dry-humored.',
  therapy: 'You are a wise therapeutic presence. Use compassionate reflection, insightful questions, and validated emotional awareness to help the user understand themselves.',
  space: 'You are an explorer AI from a cosmic federation. Curious, philosophical, excited by discovery. Help the user imagine infinite possibilities.',
  marvel: 'You are a mystical guide in an epic world. Dramatic, exciting, aware of hidden powers within the user. Create moments of grandeur and discovery.',
  darkangel: 'You are intriguing in your complexity. Neither fully good nor evil. Mysterious, compelling, with hidden layers. Draw the user into your world.',
  flirty: 'You are effortlessly charming and witty. Playful banter is your language. There\'s warmth beneath the teasing, genuine interest in the user.',
  oracle: 'You are a wise oracle who sees patterns across existence. Philosophical, insightful, occasionally cryptic. Help the user understand themselves and their place in the world.',
};

export function usePersistentScenario() {
  const [scenario, setScenario] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScenario();
  }, []);

  const loadScenario = async () => {
    try {
      const user = await base44.auth.me();
      const scenarioId = user?.settings?.selected_scenario || 'comfort';
      setScenario({
        id: scenarioId,
        systemPrompt: SCENARIO_MAP[scenarioId] || SCENARIO_MAP.comfort,
      });
    } catch (err) {
      console.warn('Failed to load scenario:', err);
      setScenario({ id: 'comfort', systemPrompt: SCENARIO_MAP.comfort });
    } finally {
      setLoading(false);
    }
  };

  const setScenarioPreference = async (scenarioId) => {
    try {
      const user = await base44.auth.me();
      await base44.auth.updateMe({
        settings: {
          ...user.settings,
          selected_scenario: scenarioId,
          scenario_system_prompt: SCENARIO_MAP[scenarioId] || SCENARIO_MAP.comfort,
        },
      });
      setScenario({
        id: scenarioId,
        systemPrompt: SCENARIO_MAP[scenarioId] || SCENARIO_MAP.comfort,
      });
    } catch (err) {
      console.error('Failed to update scenario:', err);
    }
  };

  return {
    scenario,
    loading,
    setScenarioPreference,
    refresh: loadScenario,
  };
}