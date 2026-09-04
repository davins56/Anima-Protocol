import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, FolderInput, X, Loader2, Link2 } from "lucide-react";
import { parseGithubRepoUrl, githubDownloadZipUrl } from "@/lib/codespace/importProject";

// Mythic HUD sheet for bringing a folder / zip (or a GitHub Download-ZIP
// pointer) into the in-memory Codespace tree. Sessions stay in `.sessions/`.
export default function ImportRepoModal({ open, busy, error, onClose, onPickFolder, onPickZip }) {
  const folderRef = useRef(null);
  const zipRef = useRef(null);
  const [repoUrl, setRepoUrl] = useState("");

  const parsed = parseGithubRepoUrl(repoUrl);
  const zipLink = parsed ? githubDownloadZipUrl(parsed.owner, parsed.repo) : "";

  const clearInputs = () => {
    if (folderRef.current) folderRef.current.value = "";
    if (zipRef.current) zipRef.current.value = "";
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1200] bg-black/80 backdrop-blur-sm"
            onClick={busy ? undefined : onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            className="fixed left-1/2 top-1/2 z-[1201] w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2 bg-[#0b0b16] border border-cyan-500/35 shadow-[0_0_28px_rgba(34,211,238,0.18)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-repo-title"
          >
            <div className="relative overflow-hidden border-b border-primary/15 px-5 py-4">
              <motion.div
                aria-hidden
                animate={{ x: ["-100%", "200%"] }}
                transition={{ repeat: Infinity, duration: 2.8, ease: "linear" }}
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent"
              />
              <div className="relative">
                <p id="import-repo-title" className="font-mono text-[11px] tracking-[0.3em] uppercase text-cyan-300">
                  // Import Repository
                </p>
                <p className="mt-1 font-mono text-[10px] text-primary/50 leading-relaxed">
                  Weave a folder or a zip into this Codespace. Saved sessions under
                  {" "}
                  <span className="text-primary/70">.sessions/</span>
                  {" "}
                  stay put.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <input
                ref={folderRef}
                type="file"
                className="hidden"
                multiple
                webkitdirectory=""
                directory=""
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  clearInputs();
                  if (list.length) onPickFolder(list);
                }}
              />
              <input
                ref={zipRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  clearInputs();
                  if (file) onPickZip(file);
                }}
              />

              <button
                type="button"
                disabled={busy}
                onClick={() => folderRef.current?.click()}
                className="w-full flex items-center gap-3 px-3 py-3 border border-primary/25 bg-black/40 text-left hover:border-cyan-400/50 hover:bg-cyan-500/5 disabled:opacity-40 transition-colors"
              >
                <FolderInput className="w-4 h-4 text-cyan-300 flex-shrink-0" />
                <span>
                  <span className="block font-mono text-[10px] tracking-[0.2em] uppercase text-cyan-200">
                    Choose folder
                  </span>
                  <span className="block font-mono text-[9px] text-primary/45 mt-0.5">
                    Chrome / Edge / Edge-on-Android folder picker
                  </span>
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => zipRef.current?.click()}
                className="w-full flex items-center gap-3 px-3 py-3 border border-primary/25 bg-black/40 text-left hover:border-cyan-400/50 hover:bg-cyan-500/5 disabled:opacity-40 transition-colors"
              >
                <Archive className="w-4 h-4 text-cyan-300 flex-shrink-0" />
                <span>
                  <span className="block font-mono text-[10px] tracking-[0.2em] uppercase text-cyan-200">
                    Choose .zip
                  </span>
                  <span className="block font-mono text-[9px] text-primary/45 mt-0.5">
                    A zipped repo folder — GitHub&apos;s Code → Download ZIP works
                  </span>
                </span>
              </button>

              <label className="block">
                <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] uppercase text-primary/40 mb-1.5">
                  <Link2 className="w-3 h-3" /> GitHub repo URL
                </span>
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full bg-black/50 border border-primary/20 px-3 py-2 font-mono text-[11px] text-cyan-100 placeholder:text-primary/25 focus:outline-none focus:border-cyan-500"
                />
              </label>
              {parsed && (
                <p className="font-mono text-[10px] text-primary/55 leading-relaxed">
                  The Codespace weaves files in the browser — it does not clone from
                  GitHub. Download{" "}
                  <a
                    href={zipLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                  >
                    {parsed.owner}/{parsed.repo}
                  </a>
                  {" "}as a zip, then use Choose .zip.
                </p>
              )}

              {error && (
                <p className="font-mono text-[10px] text-red-400/90 leading-relaxed">{error}</p>
              )}
              {busy && (
                <p className="flex items-center gap-2 font-mono text-[10px] text-cyan-300/80">
                  <Loader2 className="w-3 h-3 animate-spin" /> unpacking into the weave…
                </p>
              )}
            </div>

            <div className="flex border-t border-primary/15">
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/50 hover:text-primary/80 hover:bg-primary/5 disabled:opacity-40 transition-all"
              >
                <X className="w-3.5 h-3.5" /> Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
