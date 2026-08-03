import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to trigger the onboarding memory hook on first session.
 * Creates the "AI knows me" moment within 60 seconds.
 */
export function useOnboardingMemory(activeSession, characters, sessionId) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isOnboarding = params.get('onboarding') === 'true';

    if (!isOnboarding || !activeSession?.resonance_answers || (activeSession.messages?.length || 0) > 0) return;

    triggerOnboardingMemory();
  }, [activeSession, characters, sessionId]);

  const triggerOnboardingMemory = async () => {
    if (!activeSession?.resonance_answers) return;

    const user = await base44.auth.me();
    const character = characters.find(c => c.id === activeSession.character_id);
    if (!character) return;

    try {
      const result = await base44.functions.invoke('generateOnboardingMemory', {
        resonance_answers: activeSession.resonance_answers,
        character_name: character.name,
        character_id: character.id,
        session_id: sessionId,
        user_email: user?.email,
      });

      if (result?.data?.initial_message) {
        const onboardingMessage = {
          role: 'assistant',
          content: result.data.initial_message,
          character_name: character.name,
          timestamp: new Date().toISOString(),
          is_onboarding_hook: true,
        };

        setTimeout(async () => {
          const updatedMessages = [...(activeSession.messages || []), onboardingMessage];
          await base44.entities.ChatSession.update(sessionId, {
            messages: updatedMessages,
          }).catch(() => {});
        }, 800);
      }
    } catch (err) {
      console.error('Onboarding memory trigger error:', err);
    }
  };
}