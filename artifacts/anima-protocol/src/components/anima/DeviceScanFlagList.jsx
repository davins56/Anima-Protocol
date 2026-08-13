import { AlertTriangle, CheckCircle2, FolderSearch, Loader, ScanSearch, Shield, ShieldOff, Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/deviceScan";

const SEVERITY_CLASS = {
  high: "text-orange-300/90 border-orange-400/30 bg-orange-950/20",
  medium: "text-amber-300/80 border-amber-400/20 bg-amber-950/10",
  low: "text-primary/60 border-primary/15 bg-primary/5",
};

const DETAIL_LABEL = {
  migrated_local_copy: "Leftover local copy after cloud sync",
  legacy_entity_store: "Legacy local character store",
  legacy_leftover: "Stale site leftover",
  temp_or_debug: "Temp or debug key",
  oversized_unknown: "Unusually large unknown key",
  os_cruft: "OS junk file",
  temp_backup: "Temp / backup file",
  large_log: "Large log file",
  empty_file: "Empty file",
  duplicate_name: "Likely duplicate",
  junk_folder: "Junk folder",
};

export default function DeviceScanFlagList({
  flags = [],
  onClearRemovable,
  clearing = false,
  compact = false,
}) {
  if (!flags.length) {
    return (
      <div className="flex items-center gap-2 text-primary/45 font-mono text-[10px] tracking-wider">
        <CheckCircle2 className="w-3.5 h-3.5" />
        No unnecessary data flagged.
      </div>
    );
  }

  const removable = flags.filter((f) => f.removable);

  return (
    <div className="space-y-2">
      <ul className={`space-y-1.5 ${compact ? "max-h-48" : "max-h-72"} overflow-y-auto`}>
        {flags.map((flag) => (
          <li
            key={flag.id}
            className={`flex items-start gap-2 border px-2.5 py-2 font-mono ${SEVERITY_CLASS[flag.severity] || SEVERITY_CLASS.low}`}
          >
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-80" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] tracking-wide truncate" title={flag.label}>
                {flag.label}
              </p>
              <p className="text-[8px] uppercase tracking-widest opacity-70 mt-0.5">
                {DETAIL_LABEL[flag.detail] || flag.detail.replace(/_/g, " ")}
                {flag.bytes ? ` · ${formatBytes(flag.bytes)}` : ""}
                {flag.kind === "file" ? " · flagged only" : ""}
                {flag.removable ? " · can clear" : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {removable.length > 0 && onClearRemovable && (
        <button
          type="button"
          onClick={onClearRemovable}
          disabled={clearing}
          className="flex items-center gap-2 px-3 py-1.5 border border-orange-400/40 text-orange-300/80 hover:bg-orange-500/10 disabled:opacity-40 font-mono text-[9px] tracking-widest uppercase"
        >
          {clearing ? <Loader className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          {clearing ? "Clearing..." : `Clear ${removable.length} leftover site item${removable.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

export function DeviceScanPermissionToggle({ granted, onGrant, onRevoke, saving, animaName }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
          {granted ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
          Device scan permission
        </p>
        <p className="text-[9px] font-mono text-primary/30 mt-0.5 leading-relaxed">
          Allow {animaName || "your Anima"} to inspect this browser's leftover data and, if you pick a folder, flag junk files. Nothing is deleted or uploaded unless you choose it.
        </p>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={granted ? onRevoke : onGrant}
        className={`flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border font-mono text-[10px] tracking-widest uppercase transition-all disabled:opacity-40 ${
          granted
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            : "border-primary/30 text-primary/70 hover:text-primary hover:border-primary/50"
        }`}
      >
        {saving ? <Loader className="w-3 h-3 animate-spin" /> : granted ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
        {granted ? "Granted" : "Grant"}
      </button>
    </div>
  );
}

export function DeviceScanActions({
  onScanOrigin,
  onScanFolder,
  scanning,
  folderSupported,
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onScanOrigin}
        disabled={scanning}
        className="flex items-center gap-2 px-3 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 font-mono text-[10px] tracking-widest uppercase"
      >
        {scanning ? <Loader className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
        {scanning ? "Scanning..." : "Scan this device"}
      </button>
      <button
        type="button"
        onClick={onScanFolder}
        disabled={scanning || !folderSupported}
        title={folderSupported ? "Pick a folder to flag junk files" : "This browser cannot pick folders"}
        className="flex items-center gap-2 px-3 py-1.5 border border-primary/30 text-primary/70 hover:text-primary hover:border-primary/50 disabled:opacity-40 font-mono text-[10px] tracking-widest uppercase"
      >
        <FolderSearch className="w-3 h-3" />
        Scan a folder
      </button>
    </div>
  );
}
