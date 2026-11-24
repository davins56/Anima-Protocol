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
import { useMemo } from "react";
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
  const { vessel } = useCharacterVessel(config ? null : characterId);
  const saved = vessel?.config;
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
    >
      <VesselCanvas
        config={base}
        calibration={calibration}
        expression={NEUTRAL}
        mode="full"
        focus={look.form === "humanoid" ? focus : "body"}
        stage={theme}
        className="absolute inset-0"
      />
    </div>
  );
}
