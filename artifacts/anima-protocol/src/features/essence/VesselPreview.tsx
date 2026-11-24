import { Suspense, lazy } from "react";
import { VESSEL_TYPE_OPTIONS, isUserSet, labelOf, type VesselCalibration } from "./calibration";

// three.js stays out of the Essence chunk until a preview is on screen.
const CalibratedVessel = lazy(() => import("@/components/vessel/CalibratedVessel"));

/** Live calibrated vessel (3D Visual's CalibratedVessel), lazy-loaded. */
export function VesselPreview({ characterId, name, cal, className = "w-full h-72 rounded-xl" }: { characterId: string; name: string; cal: VesselCalibration; className?: string }) {
  const form = isUserSet(cal, "vesselType") ? cal.vesselType : "humanoid";
  return (
    <div className="w-full flex flex-col items-center gap-2" data-testid="essence-vessel-preview" data-vessel-type={form}>
      <Suspense fallback={<div className={`${className} bg-slate-900/60 animate-pulse`} data-testid="essence-vessel-loading" aria-label="Loading her vessel" />}>
        <CalibratedVessel calibration={cal} characterId={characterId} name={name} className={className} />
      </Suspense>
      <p className="text-[11px] text-slate-500 text-center">{labelOf(VESSEL_TYPE_OPTIONS, form)} form</p>
    </div>
  );
}
