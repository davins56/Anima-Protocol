// @ts-check
import { memo } from "react";
import { heardByCaption, heardByFromRow } from "@/lib/situationalScene";
import { useSituationalSceneView } from "./SituationalSceneContext";

/**
 * "Heard by …" under a message, from the server-stamped `heard_by` only
 * (#763 R1). Never recomputed from the cast. Legacy rows without
 * `heard_by` show nothing. Hidden with the flag off.
 *
 * @param {{ message: any, align?: "left" | "right" }} props
 */
function HeardByCaption({ message, align = "left" }) {
  const { enabled, nameOf } = useSituationalSceneView();
  if (!enabled) return null;
  const caption = heardByCaption(heardByFromRow(message), nameOf);
  if (!caption) return null;
  return (
    <p
      data-testid="heard-by"
      className={`-mt-1 mb-1 px-3 font-mono text-[9px] tracking-wider text-primary/35 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {caption}
    </p>
  );
}

export default memo(HeardByCaption);
