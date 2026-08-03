import { useEffect, useState } from 'react';

/**
 * Development tool to validate tap target sizes on mobile.
 * Displays visual overlays on buttons/interactive elements that are <44px.
 * Only visible in development when SHOW_TAP_TARGETS=true in localStorage.
 */
export default function TapTargetValidator() {
  const [targets, setTargets] = useState([]);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    // Check localStorage for debug mode
    const isDebug = localStorage.getItem('SHOW_TAP_TARGETS') === 'true';
    setIsEnabled(isDebug);

    if (!isDebug) return;

    const validateTargets = () => {
      const buttons = document.querySelectorAll('button, a[role="button"], [data-touch-target]');
      const invalidTargets = [];

      buttons.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        const height = rect.height;
        const width = rect.width;

        // iOS minimum tap target is 44x44px
        if (height < 44 || width < 44) {
          invalidTargets.push({
            id: `${rect.top}-${rect.left}`,
            top: rect.top + window.scrollY,
            left: rect.left,
            height,
            width,
            element: btn.textContent?.slice(0, 30),
          });
        }
      });

      setTargets(invalidTargets);
    };

    // Run validation on mount and after a delay (for lazy-loaded content)
    validateTargets();
    const timer = setTimeout(validateTargets, 1000);

    return () => clearTimeout(timer);
  }, []);

  if (!isEnabled || targets.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      {targets.map(target => (
        <div
          key={target.id}
          className="absolute border-2 border-red-500 bg-red-500/10 flex items-center justify-center"
          style={{
            top: `${target.top}px`,
            left: `${target.left}px`,
            width: `${target.width}px`,
            height: `${target.height}px`,
          }}
        >
          <span className="text-[10px] text-red-500 font-mono text-center p-1">
            {target.height}x{target.width}
          </span>
        </div>
      ))}
      <div className="fixed bottom-4 right-4 bg-red-500/20 border border-red-500/50 rounded px-3 py-2 text-[12px] font-mono text-red-400">
        {targets.length} undersized tap target{targets.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}