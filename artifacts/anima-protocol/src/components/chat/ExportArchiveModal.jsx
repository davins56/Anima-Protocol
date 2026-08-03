// @ts-check
import { useState } from "react";
import { Download, FileText, Loader, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

/**
 * @param {{ isOpen?: boolean, onClose: () => void, session?: any }} props
 */
export default function ExportArchiveModal({ isOpen, onClose, session }) {
  const [format, setFormat] = useState("markdown");
  const [includeSummary, setIncludeSummary] = useState(true);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!session) return;

    setExporting(true);
    try {
      const response = await base44.functions.invoke("exportSessionArchive", {
        session_id: session.id,
        format,
        include_summary: includeSummary,
      });

      if (!response?.data) {
        throw new Error("Export failed");
      }

      // Create blob and download
      const blob = new Blob([response.data], {
        type: format === "markdown" ? "text/markdown" : "text/html",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(session.title || "session").replace(/[^a-z0-9]/gi, "_")}.${format === "markdown" ? "md" : "html"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md bg-background border border-primary/30 hud-corner glow-border"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-primary/20">
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-primary" />
              <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">Export Session</h2>
            </div>
            <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-3">
                Export Format
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-primary/20 hover:border-primary/40 transition-all">
                  <input
                    type="radio"
                    name="format"
                    value="markdown"
                    checked={format === "markdown"}
                    onChange={(e) => setFormat(e.target.value)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-primary/80 font-mono">Markdown (.md)</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-primary/20 hover:border-primary/40 transition-all">
                  <input
                    type="radio"
                    name="format"
                    value="pdf"
                    checked={format === "pdf"}
                    onChange={(e) => setFormat(e.target.value)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-primary/80 font-mono">HTML (Print to PDF)</span>
                </label>
              </div>
            </div>

            {/* Include Summary */}
            <div className="pt-2 border-t border-primary/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-xs text-primary/80 font-mono">Include AI-generated chapter summary</span>
              </label>
              <p className="text-[9px] text-primary/40 mt-2 ml-7">
                AI will analyze the conversation and create a summary to act as a chapter archive.
              </p>
            </div>

            {/* Info */}
            <div className="bg-primary/5 border border-primary/10 p-3 space-y-1">
              <div className="flex items-start gap-2">
                <FileText className="w-3.5 h-3.5 text-primary/50 flex-shrink-0 mt-0.5" />
                <div className="text-[9px] text-primary/50 space-y-0.5">
                  <p>Session: <span className="text-primary/70">{session?.title || "Untitled"}</span></p>
                  <p>Messages: <span className="text-primary/70">{(session?.messages || []).length}</span></p>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-primary/20 flex gap-3">
            <button
              onClick={onClose}
              disabled={exporting}
              className="flex-1 px-4 py-2.5 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex-1 px-4 py-2.5 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border flex items-center justify-center gap-2"
            >
              {exporting ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" />
                  Export
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}