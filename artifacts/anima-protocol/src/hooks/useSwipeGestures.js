import { useEffect, useRef, useCallback } from 'react';

export function useSwipeGestures({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  threshold = 100,
  excludeSelector = null,
}) {
  const touchStartRef = useRef({ x: 0, y: 0 });
  const blockedRef = useRef(false);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  const onSwipeUpRef = useRef(onSwipeUp);
  const onSwipeDownRef = useRef(onSwipeDown);

  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
    onSwipeUpRef.current = onSwipeUp;
    onSwipeDownRef.current = onSwipeDown;
  }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  useEffect(() => {
    const isScrollable = (el) => {
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        const overflowX = style.overflowX;
        const overflowY = style.overflowY;
        const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
        const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        if (canScrollX || canScrollY) return true;
        el = el.parentElement;
      }
      return false;
    };

    const isExcluded = (el) => {
      if (!excludeSelector) return false;
      const selectors = excludeSelector.split(',').map(s => s.trim());
      while (el && el !== document.body) {
        for (const sel of selectors) {
          try {
            if (el.matches?.(sel)) return true;
          } catch {}
        }
        el = el.parentElement;
      }
      return false;
    };

    const handleTouchStart = (e) => {
      const target = e.target;
      // Block if touch starts on excluded element or scrollable container
      blockedRef.current = isExcluded(target) || isScrollable(target);
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    };

    const handleTouchEnd = (e) => {
      if (blockedRef.current) return;

      const touchEnd = {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY,
      };

      const deltaX = touchEnd.x - touchStartRef.current.x;
      const deltaY = touchEnd.y - touchStartRef.current.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      // Only trigger horizontal swipe if it's clearly more horizontal than vertical
      // and exceeds the threshold (reduced multiplier for better responsiveness on mobile)
      if (absDeltaX > absDeltaY && absDeltaX > threshold) {
        if (deltaX < 0) {
          onSwipeLeftRef.current?.();
        } else {
          onSwipeRightRef.current?.();
        }
      } else if (absDeltaY > absDeltaX && absDeltaY > threshold) {
        if (deltaY < 0) {
          onSwipeUpRef.current?.();
        } else {
          onSwipeDownRef.current?.();
        }
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [threshold, excludeSelector]);
}