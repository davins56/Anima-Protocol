import { useState } from "react";
import { ScanSearch } from "lucide-react";
import {
  canPickDirectory,
  clearRemovableOriginFlags,
  pickDirectoryHandle,
  scanOriginStorage,
  scanPickedDirectory,
} from "@/lib/deviceScan";
import {
  grantDeviceScanForAnima,
  runDeviceScan,
} from "@/lib/animaDeviceScan";
import { track } from "@/lib/analytics";
import DeviceScanFlagList from "@/components/anima/DeviceScanFlagList";

export default function DeviceScanCard({ payload, animaName }) {
  const [report, setReport] = useState(payload?.report || null);
  const [needsPermission, setNeedsPermission] = useState(Boolean(payload?.needs_permission));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const animaId = payload?.anima_id || report?.animaId || null;

  const grantAndScan = async () => {
    setBusy(true);
    setError("");
    try {
      await grantDeviceScanForAnima(animaId);
      const next = await runDeviceScan({ includeFolder: false });
      next.animaId = animaId;
      setReport(next);
      setNeedsPermission(false);
      track("device_scan_completed", {
        flag_count: (next.flags || []).length,
        has_folder_grant: false,
        is_anima: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grant and scan.");
    } finally {
      setBusy(false);
    }
  };

  const scanFolder = async () => {
    setBusy(true);
    setError("");
    try {
      const origin = await scanOriginStorage();
      const handle = await pickDirectoryHandle();
      const next = await scanPickedDirectory(handle, origin);
      next.animaId = animaId;
      setReport(next);
      track("device_scan_completed", {
        flag_count: (next.flags || []).length,
        has_folder_grant: true,
        is_anima: true,
      });
    } catch (err) {
      if (err?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Folder scan failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const clearLeftovers = () => {
    if (!report?.flags?.length) return;
    const { cleared } = clearRemovableOriginFlags(report.flags);
    const clearedIds = new Set(cleared.map((f) => f.id));
    setReport((prev) => ({
      ...prev,
      flags: (prev.flags || []).filter((f) => !clearedIds.has(f.id)),
    }));
  };

  return (
    <div className="mt-3 border border-primary/20 bg-black/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-primary/60">
        <ScanSearch className="w-3.5 h-3.5" />
        <span className="font-mono text-[8px] tracking-[0.25em] uppercase">
          Device scan · {animaName || "Anima"}
        </span>
      </div>
      {needsPermission && (
        <button
          type="button"
          onClick={grantAndScan}
          disabled={busy}
          className="flex items-center gap-2 px-3 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 font-mono text-[9px] tracking-widest uppercase"
        >
          {busy ? "Granting..." : "Grant permission & scan"}
        </button>
      )}
      {!needsPermission && canPickDirectory() && (
        <button
          type="button"
          onClick={scanFolder}
          disabled={busy}
          className="font-mono text-[8px] tracking-widest uppercase text-primary/45 hover:text-primary"
        >
          {busy ? "Scanning folder..." : "Also scan a folder"}
        </button>
      )}
      {error && <p className="text-[8px] font-mono text-destructive/70">{error}</p>}
      {report && !needsPermission && (
        <DeviceScanFlagList
          compact
          flags={report.flags || []}
          onClearRemovable={clearLeftovers}
        />
      )}
    </div>
  );
}
