// @ts-check
import { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STORAGE_KEY = "ai_disclaimer_accepted";

/**
 * @param {{ onAccept?: () => void }} props
 */
export default function AIDisclaimerModal({ onAccept }) {
  // Read localStorage synchronously — no flicker, no re-run on prop change
  const [hasAccepted, setHasAccepted] = useState(
    () => !!localStorage.getItem(STORAGE_KEY)
  );
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
  }, []);

  // Call onAccept once if already accepted (e.g. parent needs to know)
  useEffect(() => {
    if (hasAccepted) onAccept?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAccept = () => {
    localStorage.setItem("ai_disclaimer_accepted", "true");
    setHasAccepted(true);
    onAccept?.();
  };

  if (hasAccepted) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 z-[999] flex items-center justify-center p-4 ${
          isIOS ? "bg-black/40 backdrop-blur-md" : "bg-black/90 backdrop-blur-sm"
        }`}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3 }}
          className={`w-full ${
            isIOS ? "max-w-sm rounded-2xl" : "max-w-2xl"
          } bg-background ${
            isIOS
              ? "border-0 shadow-2xl"
              : "border border-primary/30 hud-corner glow-border"
          } max-h-[90vh] overflow-hidden flex flex-col`}
        >
          {/* Header */}
          <div className={`${isIOS ? "px-6 pt-6 pb-4" : "p-6 border-b border-primary/20 bg-black/60 backdrop-blur-md"}`}>
            {isIOS ? (
              <div className="text-center">
                <h2 className="font-sans font-semibold text-lg text-primary mb-1">
                  Important: AI Disclosure
                </h2>
                <p className="text-xs text-primary/60">Please read before continuing</p>
              </div>
            ) : (
              <div className="flex items-start gap-4">
                <AlertTriangle className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                    Important: AI Disclosure
                  </h2>
                  <p className="text-[10px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
                    Please read before continuing
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          <div className={`flex-1 overflow-y-auto ${isIOS ? "px-6 py-4 space-y-4 text-sm leading-relaxed" : "p-6 space-y-6 font-mono text-sm text-primary/70 leading-relaxed"}`}>
            
            <div className={`${isIOS ? "py-3 text-primary/80" : "border border-primary/15 bg-primary/5 p-4 space-y-3"}`}>
              <p className={isIOS ? "text-base" : "text-primary/90"}>
                This application is powered by Artificial Intelligence. It is intended for <span className="font-semibold">informational purposes only</span> and does <span className="font-semibold">not</span> constitute professional advice.
              </p>
            </div>

            <section className="space-y-3">
              <h3 className={`${isIOS ? "text-sm font-semibold text-primary/90" : "text-primary text-sm tracking-widest uppercase"}`}>What You Should Know</h3>
              <ul className={`space-y-2 ${isIOS ? "pl-4 text-primary/70" : "ml-4 list-disc list-inside text-primary/70"}`}>
                <li>AI systems can produce inaccurate or biased information</li>
                <li>Responses may contain false statements</li>
                <li>Information may be outdated or incomplete</li>
                <li>Not a substitute for professional consultation</li>
                <li>You are responsible for verifying information</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h3 className={`${isIOS ? "text-sm font-semibold text-primary/90" : "text-primary text-sm tracking-widest uppercase"}`}>Your Responsibility</h3>
              <p className={isIOS ? "text-primary/70 text-sm" : ""}>
                By using this application, you acknowledge that you are responsible for verifying all information and making your own informed decisions.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className={`${isIOS ? "text-sm font-semibold text-primary/90" : "text-primary text-sm tracking-widest uppercase"}`}>Data Privacy</h3>
              <p className={isIOS ? "text-primary/70 text-sm" : ""}>
                Your conversations are collected to provide the service. Your data is not used to train our models unless you opt in.
              </p>
            </section>

            {!isIOS && (
              <div className="border border-primary/15 bg-primary/5 p-4">
                <p className="text-[11px] text-primary/60 italic">
                  For more information, review our <a href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</a> and <a href="/disclaimer" className="text-primary hover:underline">Full Disclaimer</a>.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`${isIOS ? "border-t border-primary/10 px-6 py-4 space-y-3" : "border-t border-primary/20 bg-black/60 backdrop-blur-md p-6 flex gap-4"}`}>
            {isIOS ? (
              <>
                <button
                  onClick={handleAccept}
                  className="w-full px-4 py-3 bg-primary/20 text-primary font-semibold rounded-lg text-base transition-colors hover:bg-primary/30 active:bg-primary/25"
                >
                  I Understand & Accept
                </button>
                <p className="text-xs text-center text-primary/50">Review <a href="/privacy-policy" className="text-primary/70 underline">Privacy Policy</a></p>
              </>
            ) : (
              <button
                onClick={handleAccept}
                className="flex-1 px-6 py-3 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                I Understand & Accept
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}