import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function GoToTopButton({ containerRef }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;

    const onScroll = () => setVisible(el.scrollTop > 400);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15 }}
          onClick={scrollToTop}
          className="absolute bottom-4 right-4 z-20 p-2 bg-black/80 border border-primary/40 text-primary/70 hover:text-primary hover:border-primary hover:bg-primary/10 transition-all backdrop-blur-sm font-mono text-[8px] tracking-widest flex items-center gap-1.5 shadow-lg"
          title="Jump to top"
        >
          <ArrowUp className="w-3 h-3" />
          <span className="hidden sm:inline uppercase">Top</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}