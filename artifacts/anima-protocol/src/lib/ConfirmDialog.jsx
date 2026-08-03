import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const ConfirmContext = createContext(null);

const DEFAULTS = {
  title: "Are you sure?",
  message: "",
  confirmLabel: "Delete",
  cancelLabel: "Cancel",
  heading: "Confirm",
};

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({ ...DEFAULTS, ...options });
    });
  }, []);

  const close = useCallback((result) => {
    setState(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-sm"
              onClick={() => close(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={{ type: "spring", damping: 28, stiffness: 360 }}
              className="fixed left-1/2 top-1/2 z-[2001] w-[88%] max-w-xs -translate-x-1/2 -translate-y-1/2 bg-[#090912] border border-primary/30 shadow-[0_0_30px_rgba(34,211,238,0.15)]"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
            >
              <div className="px-5 py-3 border-b border-primary/10">
                <span className="font-mono text-[11px] tracking-[0.3em] text-primary/80 uppercase">
                  // {state.heading}
                </span>
              </div>
              <div className="px-5 py-5">
                <p
                  id="confirm-dialog-title"
                  className="text-sm text-primary/90 leading-relaxed"
                >
                  {state.title}
                </p>
                {state.message && (
                  <p className="mt-2 text-xs text-primary/50 leading-relaxed">
                    {state.message}
                  </p>
                )}
              </div>
              <div className="flex border-t border-primary/10">
                <button
                  onClick={() => close(false)}
                  className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/50 hover:text-primary/80 hover:bg-primary/5 transition-all"
                >
                  {state.cancelLabel}
                </button>
                <button
                  onClick={() => close(true)}
                  className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-red-400 hover:text-red-300 hover:bg-red-500/10 border-l border-primary/10 transition-all"
                >
                  {state.confirmLabel}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return ctx;
}
