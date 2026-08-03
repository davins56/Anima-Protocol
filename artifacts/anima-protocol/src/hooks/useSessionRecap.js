// @ts-check
import { useState, useCallback } from "react";

export const useSessionRecap = () => {
  const [showRecap, setShowRecap] = useState(false);
  const [recapSessionId, setRecapSessionId] = useState(/** @type {string | null} */ (null));

  const openRecap = useCallback((/** @type {string} */ sessionId) => {
    setRecapSessionId(sessionId);
    setShowRecap(true);
  }, []);

  const closeRecap = useCallback(() => {
    setShowRecap(false);
    setRecapSessionId(null);
  }, []);

  return {
    showRecap,
    recapSessionId,
    openRecap,
    closeRecap,
  };
};