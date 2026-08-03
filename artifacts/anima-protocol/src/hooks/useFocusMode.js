import { useState, useEffect } from 'react';

export function useFocusMode() {
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Persist focus mode preference
  useEffect(() => {
    const saved = localStorage.getItem('focus_mode');
    if (saved) {
      setIsFocusMode(JSON.parse(saved));
    }
  }, []);

  const toggleFocusMode = () => {
    const newState = !isFocusMode;
    setIsFocusMode(newState);
    localStorage.setItem('focus_mode', JSON.stringify(newState));
  };

  return { isFocusMode, toggleFocusMode };
}