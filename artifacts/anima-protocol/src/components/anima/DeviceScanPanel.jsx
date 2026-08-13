import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";
import { track } from "@/lib/analytics";
import {
  canPickDirectory,
  clearRemovableOriginFlags,
  hasDeviceScanPermission,
  pickDirectoryHandle,
  scanOriginStorage,
  scanPickedDirectory,
  summarizeScan,
  writeDeviceScanPermission,
} from "@/lib/deviceScan";
import {
  grantDeviceScanForAnima,
  revokeDeviceScanForAnima,
} from "@/lib/animaDeviceScan";
import DeviceScanFlagList, {
  DeviceScanActions,
  DeviceScanPermissionToggle,
} from "@/components/anima/DeviceScanFlagList";

export default function DeviceScanPanel({ anima, onPermissionChange }) {
  const [granted, setGranted] = useState(() => hasDeviceScanPermission());
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (hasDeviceScanPermission()) {
      setGranted(true);
      return;
    }
    if (anima?.device_scan_granted) {
      writeDeviceScanPermission(true, anima.id || null);
      setGranted(true);
      return;
    }
    setGranted(false);
  }, [anima?.id, anima?.device_scan_granted]);

  const persistGrant = async (next) => {
    setSaving(true);
    setError("");
    try {
      if (next) await grantDeviceScanForAnima(anima?.id);
      else await revokeDeviceScanForAnima(anima?.id);
      setGranted(next);
      onPermissionChange?.(next);
      if (!next) setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update permission.");
    } finally {
      setSaving(false);
    }
  };

  const finishScan = (nextReport) => {
    setReport(nextReport);
    const summary = summarizeScan(nextReport);
    track("device_scan_completed", {
      flag_count: summary.flagCount,
      has_folder_grant: Boolean(nextReport?.folder && !nextReport.folder.unsupported),
      is_anima: true,
    });
  };

  const scanOrigin = async () => {
    if (!granted) {
      setError("Grant permission before scanning this device.");
      return;
    }
    setScanning(true);
    setError("");
    try {
      finishScan(await scanOriginStorage());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const scanFolder = async () => {
    if (!granted) {
      setError("Grant permission before scanning a folder.");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const origin = await scanOriginStorage();
      const handle = await pickDirectoryHandle();
      finishScan(await scanPickedDirectory(handle, origin));
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "Folder scan failed.");
      }
    } finally {
      setScanning(false);
    }
  };

  const clearLeftovers = () => {
    if (!report?.flags?.length) return;
    setClearing(true);
    try {
      const { cleared } = clearRemovableOriginFlags(report.flags);
      const clearedIds = new Set(cleared.map((f) => f.id));
      setReport((prev) => {
        if (!prev) return prev;
        const flags = (prev.flags || []).filter((f) => !clearedIds.has(f.id));
        const originFlags = (prev.origin?.localStorage?.flags || []).filter(
          (f) => !clearedIds.has(f.id),
        );
        return {
          ...prev,
          flags,
          origin: {
            ...prev.origin,
            localStorage: {
              ...(prev.origin?.localStorage || {}),
              flags: originFlags,
            },
          },
        };
      });
    } finally {
      setClearing(false);
    }
  };

  const summary = report ? summarizeScan(report) : null;

  return (
    <div className="border border-primary/15 bg-black/40 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ScanSearch className="w-4 h-4 text-primary/60" />
        <span className="font-mono text-[10px] text-primary/50 tracking-[0.25em] uppercase">
          Device scan
        </span>
      </div>
      <DeviceScanPermissionToggle
        granted={granted}
        saving={saving}
        animaName={anima?.name}
        onGrant={() => persistGrant(true)}
        onRevoke={() => persistGrant(false)}
      />
      <p className="text-[9px] font-mono text-primary/30 leading-relaxed">
        Origin scan looks at this site's leftover storage on the device. A folder scan uses the browser picker and only flags junk (temp files, OS cruft, empty copies) — it never uploads file contents.
      </p>
      <DeviceScanActions
        scanning={scanning}
        folderSupported={canPickDirectory()}
        onScanOrigin={scanOrigin}
        onScanFolder={scanFolder}
      />
      {error && (
        <p className="text-[9px] font-mono text-destructive/70">{error}</p>
      )}
      {summary && (
        <div className="space-y-2">
          <p className="font-mono text-[9px] text-primary/45 tracking-widest uppercase">
            {summary.flagCount === 0
              ? "Scan complete — nothing flagged"
              : `${summary.flagCount} flagged · ${summary.high} high · ${summary.medium} medium · ${summary.low} low`}
            {report.folder?.name ? ` · folder ${report.folder.name}` : ""}
          </p>
          <DeviceScanFlagList
            flags={report.flags || []}
            clearing={clearing}
            onClearRemovable={clearLeftovers}
          />
        </div>
      )}
    </div>
  );
}
