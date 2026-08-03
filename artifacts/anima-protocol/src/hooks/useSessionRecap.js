import { useState, useCallback } from "react";

export const useSessionRecap = () => {
  const [showRecap, setShowRecap] = useState(false);
  const [recapSessionId, setRecapSessionId] = useState(null);

  const openRecap = useCallback((sessionId) => {
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