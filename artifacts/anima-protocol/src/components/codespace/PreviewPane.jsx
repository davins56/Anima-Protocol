import { RefreshCw, Globe } from "lucide-react";

// Live preview of the web project. The iframe is sandboxed with allow-scripts
// only (no allow-same-origin), so it runs on a unique opaque origin and cannot
// read the parent app's cookies, storage, Clerk session, or DOM. Content is fed
// via srcdoc built from the virtual file set.
export default function PreviewPane({ srcdoc, onRefresh }) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#090912] border-b border-primary/15">
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/60">
          <Globe className="w-3 h-3" /> Preview
        </span>
        <button
          onClick={onRefresh}
          className="text-primary/40 hover:text-primary transition-colors"
          title="Rebuild preview"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
      {srcdoc ? (
        <iframe
          title="codespace-preview"
          srcDoc={srcdoc}
          sandbox="allow-scripts allow-modals"
          className="flex-1 w-full border-0 bg-white"
        />
      ) : (
        <div className="flex-1 grid place-items-center bg-[#06060d]">
          <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
            Run a web project to see it here
          </p>
        </div>
      )}
    </div>
  );
}
