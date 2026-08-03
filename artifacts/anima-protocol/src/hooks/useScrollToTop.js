// @ts-check
import { useState, useCallback } from 'react';

/**
 * @param {number} [threshold]
 */
export function useScrollToTop(threshold = 300) {
  const [showButton, setShowButton] = useState(false);

  const handleScroll = useCallback((/** @type {{ target: { scrollTop: number } }} */ e) => {
    setShowButton(e.target.scrollTop > threshold);
  }, [threshold]);

  const scrollToTop = useCallback((/** @type {{ current: HTMLElement | null }} */ containerRef) => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return { showButton, handleScroll, scrollToTop };
}