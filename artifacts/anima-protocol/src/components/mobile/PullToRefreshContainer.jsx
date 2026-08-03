import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

/**
 * Pull-to-Refresh container for iOS-like native feel on mobile.
 * Desktop users can click the refresh button instead.
 */
export default function PullToRefreshContainer({ children, onRefresh, isLoading = false }) {
  const containerRef = useRef(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const scrollTop = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e) => {
      touchStartY.current = e.touches[0].clientY;
      scrollTop.current = container.scrollTop;
    };

    const handleTouchMove = (e) => {
      if (scrollTop.current === 0) {
        const distance = e.touches[0].clientY - touchStartY.current;
        if (distance > 0) {
          setPullDistance(Math.min(distance, 120)); // Cap at 120px
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = async () => {
      if (pullDistance > 80 && !isRefreshing && onRefresh) {
        setIsRefreshing(true);
        setPullDistance(0);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
        }
      } else {
        setPullDistance(0);
      }
    };

    container.addEventListener('touchstart', handleTouchStart);
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, isRefreshing, onRefresh]);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto overflow-x-hidden"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Pull-to-Refresh indicator */}
      <div
        className="absolute left-0 right-0 flex justify-center"
        style={{
          top: `${Math.max(-60, -120 + pullDistance)}px`,
          height: '60px',
          pointerEvents: 'none',
        }}
      >
        <motion.div
          animate={{
            opacity: pullDistance > 40 ? 1 : 0.3,
            rotate: isRefreshing ? 360 : (pullDistance / 120) * 360,
          }}
          transition={{ rotate: { duration: isRefreshing ? 1 : 0 }, duration: 0.2 }}
          className="flex items-center justify-center"
        >
          <RefreshCw className="w-5 h-5 text-primary" />
        </motion.div>
      </div>

      {/* Content with pull effect */}
      <motion.div
        animate={{ y: isRefreshing ? 60 : pullDistance }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {children}
      </motion.div>

      {/* Loading spinner when actually refreshing */}
      {isRefreshing && (
        <div className="flex justify-center py-4">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity }}>
            <RefreshCw className="w-4 h-4 text-primary/50" />
          </motion.div>
        </div>
      )}
    </div>
  );
}