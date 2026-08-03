import { useState, useCallback } from 'react';

export function useScrollToTop(threshold = 300) {
  const [showButton, setShowButton] = useState(false);

  const handleScroll = useCallback((e) => {
    setShowButton(e.target.scrollTop > threshold);
  }, [threshold]);

  const scrollToTop = useCallback((containerRef) => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return { showButton, handleScroll, scrollToTop };
}