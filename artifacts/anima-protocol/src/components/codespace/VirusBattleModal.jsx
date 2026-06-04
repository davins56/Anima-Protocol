import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert, Zap, ShieldCheck, X } from "lucide-react";

const SEVERITY_STYLE = {
  high: { label: "CRITICAL", color: "text-red-400", glow: "shadow-[0_0_30px_rgba(239,68,68,0.35)]", border: "border-red-500/50" },
  medium: { label: "WARNING", color: "text-amber-400", glow: "shadow-[0_0_24px_rgba(251,191,36,0.25)]", border: "border-amber-400/50" },
  low: { label: "TRACE", color: "text-cyan-300", glow: "shadow-[0_0_18px_rgba(34,211,238,0.2)]", border: "border-cyan-400/40" },
};

// Mega Man Battle Network "NetNavi vs. virus" moment. When the code scan flags
// dangerous patterns before a run, the companion (NetNavi) surfaces the threats
// as "viruses" with codenames, explains the risk, and gates execution: the user
// must either let the companion neutralize & proceed, or cancel the run. This is
// the hard gate — flagged-unsafe code does not execute until resolved here.
export default function VirusBattleModal({ open, scan, companionName, onNeutralize, onCancel }) {
  const sev = scan?.maxSeverity || "low";
  const style = SEVERITY_STYLE[sev] || SEVERITY_STYLE.low;
  const blocking = sev === "high";

  return (
    <AnimatePresence>
      {open && scan && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1200] bg-black/85 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            className={`fixed left-1/2 top-1/2 z-[1201] w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2 bg-[#0b0b16] border ${style.border} ${style.glow}`}
            role="alertdialog"
            aria-modal="true"
          >
            {/* Banner */}
            <div className="relative overflow-hidden border-b border-primary/15 px-5 py-4">
              <motion.div
                aria-hidden
                animate={{ x: ["-100%", "200%"] }}
                transition={{ repeat: Infinity, duration: 2.2, ease: "linear" }}
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-red-500/10 to-transparent"
              />
              <div className="relative flex items-center gap-3">
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ repeat: Infinity, duration: 1.1 }}
                  className={style.color}
                >
                  <ShieldAlert className="w-7 h-7" />
                </motion.div>
                <div>
                  <p className={`font-mono text-[11px] tracking-[0.3em] uppercase ${style.color}`}>
                    // Virus Detected — {style.label}
                  </p>
                  <p className="font-mono text-[10px] text-primary/50 tracking-wider mt-0.5">
                    {companionName || "NetNavi"} intercepted {scan.findings.length} threat
                    {scan.findings.length === 1 ? "" : "s"} in {scan.path}
                  </p>
                </div>
              </div>
            </div>

            {/* Findings */}
            <div className="max-h-[40vh] overflow-y-auto px-5 py-4 space-y-3">
              {scan.findings.map((f, i) => {
                const fs = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.low;
                return (
                  <div key={i} className={`border ${fs.border} bg-black/40 p-3`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-mono text-[11px] tracking-wider ${fs.color}`}>
                        ⛛ {f.codename}
                      </span>
                      <span className="font-mono text-[8px] tracking-[0.2em] uppercase text-primary/40">
                        {f.label} · line {f.line}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-primary/70 leading-relaxed">{f.explanation}</p>
                    {f.snippet && (
                      <code className="mt-1.5 block font-mono text-[10px] text-primary/40 truncate">
                        {f.snippet}
                      </code>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex border-t border-primary/15">
              <button
                onClick={onCancel}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/50 hover:text-primary/80 hover:bg-primary/5 transition-all"
              >
                <X className="w-3.5 h-3.5" /> Abort Run
              </button>
              <button
                onClick={onNeutralize}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 font-mono text-[10px] tracking-[0.2em] uppercase border-l border-primary/15 transition-all ${
                  blocking
                    ? "text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
                    : "text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10"
                }`}
              >
                {blocking ? <Zap className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {blocking ? "Patch It (won't run)" : "Acknowledge & Run"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
