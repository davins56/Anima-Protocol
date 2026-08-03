import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

// Singleton store for check-in context — accessible across components without prop drilling
let _globalCheckInContext = "";
const _listeners = new Set();

export const getCheckInContext = () => _globalCheckInContext;
export const setGlobalCheckInContext = (ctx) => {
  _globalCheckInContext = ctx;
  _listeners.forEach(fn => fn(ctx));
};

export const useCheckInRitual = (sessionId, characterId) => {
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [checkInContext, setCheckInContext] = useState(_globalCheckInContext);

  // Subscribe to global check-in context updates
  useEffect(() => {
    const handler = (ctx) => setCheckInContext(ctx);
    _listeners.add(handler);
    return () => _listeners.delete(handler);
  }, []);

  useEffect(() => {
    const checkDailyCheckIn = async () => {
      try {
        const user = await base44.auth.me();
        if (!user || !sessionId) return; // Only require check-in if there's an active session
        
        const today = new Date().toISOString().split('T')[0];
        const existingCheckIns = await base44.entities.CheckIn.filter({
          user_email: user.email,
          check_in_date: today,
        });
        
        if (existingCheckIns && existingCheckIns.length > 0) {
          setHasCheckedInToday(true);
          setShowCheckIn(false);
          // Restore context from last check-in if available
          const ci = existingCheckIns[0];
          const ctx = `User mood: ${ci.mood}. Focus: ${ci.current_focus || 'unspecified'}. Insight: ${ci.revelation || 'none'}. Notes: ${ci.freeform_note || 'none'}`;
          setGlobalCheckInContext(ctx);
        } else {
          // Require check-in: show modal and keep it visible
          setHasCheckedInToday(false);
          setShowCheckIn(true);
        }
      } catch (err) {
        console.error('Check-in check failed:', err);
      }
    };

    checkDailyCheckIn();
  }, [sessionId]);

  const submitCheckIn = async (checkInData) => {
    const user = await base44.auth.me();
    const today = new Date().toISOString().split('T')[0];

    const newCheckIn = await base44.entities.CheckIn.create({
      session_id: sessionId,
      user_email: user.email,
      check_in_date: today,
      mood: checkInData.mood,
      current_focus: checkInData.currentFocus,
      revelation: checkInData.revelation,
      freeform_note: checkInData.freeformNote,
      processed: false,
    });

    // Build context string and set globally
    const ctx = `User mood: ${checkInData.mood}. Focus: ${checkInData.currentFocus || 'unspecified'}. Insight: ${checkInData.revelation || 'none'}. Notes: ${checkInData.freeformNote || 'none'}`;
    setGlobalCheckInContext(ctx);

    // Process in background — inject into world state & character emotion
    if (characterId) {
      base44.functions.invoke('ingestCheckInToWorldState', {
        check_in_id: newCheckIn.id,
        session_id: sessionId,
        character_id: characterId,
      }).catch(err => console.error('Check-in ingestion error:', err));
    }

    setHasCheckedInToday(true);
    setShowCheckIn(false);
    return newCheckIn;
  };

  // Check-in is required if modal is showing and user hasn't completed today's check-in
  const isCheckInRequired = showCheckIn && !hasCheckedInToday;

  return {
    showCheckIn,
    setShowCheckIn: (val) => {
      // Prevent dismissing the modal if check-in is still required
      if (!val && isCheckInRequired) return;
      setShowCheckIn(val);
    },
    hasCheckedInToday,
    isCheckInRequired,
    checkInContext,
    submitCheckIn,
  };
};