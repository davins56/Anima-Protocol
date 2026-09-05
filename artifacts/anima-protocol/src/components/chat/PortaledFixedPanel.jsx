import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import useAnchoredFixedPosition from "@/hooks/useAnchoredFixedPosition";

/**
 * Render a HUD panel (and optional dismiss backdrop) on document.body so
 * overflow-hidden chat chrome and the z-[999] tab bar cannot clip it.
 */
export default function PortaledFixedPanel({
  open,
  onDismiss,
  anchorRef,
  align = "right",
  className = "",
  panelStyle,
  children,
  panelTestId,
  backdropTestId,
  backdropZClass = "z-[1000]",
  panelZClass = "z-[1001]",
  maxHeightRatio,
  gap,
  motionInitial = { opacity: 0, y: -8 },
  motionAnimate = { opacity: 1, y: 0 },
  motionExit = { opacity: 0, y: -8 },
  motionTransition = { duration: 0.15 },
}) {
  const pos = useAnchoredFixedPosition(anchorRef, open, { align, maxHeightRatio, gap });

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && pos ? (
        <>
          {onDismiss ? (
            <div
              data-testid={backdropTestId}
              className={`fixed inset-0 ${backdropZClass}`}
              onClick={onDismiss}
            />
          ) : null}
          <motion.div
            data-testid={panelTestId}
            initial={motionInitial}
            animate={motionAnimate}
            exit={motionExit}
            transition={motionTransition}
            className={`${panelZClass} ${className}`}
            style={panelStyle ? { ...pos, ...panelStyle } : pos}
          >
            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
