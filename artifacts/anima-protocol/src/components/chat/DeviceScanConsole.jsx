import { ScanSearch, X } from "lucide-react";
import DeviceScanPanel from "@/components/anima/DeviceScanPanel";

export default function DeviceScanConsole({ anima, onClose }) {
  return (
    <div className="border-t border-primary/10 bg-black/40 backdrop-blur-md">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <ScanSearch className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/50 tracking-widest uppercase">
            Device scan
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-primary/30 hover:text-primary/70 transition-colors"
          aria-label="Close device scan"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-3">
        <DeviceScanPanel anima={anima} />
      </div>
    </div>
  );
}
