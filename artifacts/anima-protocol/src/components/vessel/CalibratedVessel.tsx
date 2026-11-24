/**
 * Anima Essence live preview: <CalibratedVessel calibration={...} characterId={...} />.
 *
 * Drop-in for the Calibrate screen's portrait / placeholder. It renders her
 * real saved vessel (or the preset default when none is saved) with the
 * calibration applied after precedence: only fields whose source is `user`
 * change the vessel, so photo-derived and studio looks stay put until the
 * user edits a control (setCalibrationField marks it `user`).
 *
 * iPad Safari (#728/#729): ONE canvas (VesselCanvas), frameloop="demand"
 * (renders on change, a short pulse, then a low idle tick; offscreen/hidden →
 * never), the shared renderer quality tier for DPR/antialias, a single static
 * frame under prefers-reduced-motion, no post-processing / bloom. The stage
 * background is CSS (alpha canvas), not a WebGL pass. The chat header is not
 * this component: it stays a still image (VesselPortrait).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import VesselCanvas from "./VesselCanvas";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { expressionFor } from "@/lib/vessel/emotion";
import { defaultVesselFor, type VesselConfig } from "@/lib/vessel/vesselConfig";
import { STAGES, resolveCalibratedLook, type StageTheme } from "@/lib/vessel/vesselCalibration";

type Props = {
  /** The calibration being edited (vesselCalibration v1, any partial shape is normalized). */
  calibration: unknown;
  /** Loads her saved vessel as the base. Ignored when `config` is given. */
  characterId?: string | null;
  /** Used for the preset default when nothing is saved. */
  name?: string | null;
  /** Explicit base vessel (tests, Vessel Studio). */
  config?: VesselConfig | null;
  className?: string;
  /** Head close-up instead of full body (humanoid only). */
  focus?: "body" | "head";
};

const NEUTRAL = expressionFor("neutral", 50);

export default function CalibratedVessel({ calibration, characterId, name, config, className, focus = "body" }: Props) {
  const fetchId = config ? null : characterId || null;
  const { vessel, loading } = useCharacterVessel(fetchId);
  // Hold the canvas until her saved vessel has loaded (or is known missing), so
  // the preview never flashes the preset default or the previous character.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const wasLoading = useRef(false);
  useEffect(() => {
    if (loading) wasLoading.current = true;
    else if (wasLoading.current) {
      wasLoading.current = false;
      setSettledFor(fetchId);
    }
  }, [loading, fetchId]);
  const ready = !fetchId || settledFor === fetchId;
  const saved = ready ? vessel?.config : undefined;
  const base = useMemo(() => config ?? saved ?? defaultVesselFor({ name: name || "" }), [config, saved, name]);
  const look = useMemo(() => resolveCalibratedLook(base, calibration), [base, calibration]);
  const theme: StageTheme = look.theme ?? "dark";
  return (
    <div
      className={`relative overflow-hidden ${className || "w-full h-72"}`}
      style={{ background: STAGES[theme].background }}
      data-testid="calibrated-vessel"
      data-vessel-form={look.form}
      data-stage={theme}
      data-ready={ready ? "1" : "0"}
    >
      {ready ? (
      <VesselCanvas
        config={base}
        calibration={calibration}
        expression={NEUTRAL}
        mode="full"
        focus={look.form === "humanoid" ? focus : "body"}
        // Studio lights unless the user picked a theme (null keeps them).
        stage={look.theme}
        className="absolute inset-0"
      />
      ) : null}
    </div>
  );
}
