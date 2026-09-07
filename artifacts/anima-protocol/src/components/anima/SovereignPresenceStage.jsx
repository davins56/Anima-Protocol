import { motion } from "framer-motion";
import AnimaVessel4D from "@/components/anima/AnimaVessel4D";

/**
 * Full-screen Sovereign Presence — 3D full-body vessel stage.
 * Progressive enhancement over 2D LivingPresence sprites.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   model?: { color?: string, accent?: string, texture_url?: string, gltf_url?: string, name?: string },
 *   expression?: number,
 *   title?: string,
 * }} props
 */
export default function SovereignPresenceStage({
  open,
  onClose,
  model,
  expression = 0.35,
  title,
  layers,
  sequences,
}) {
  if (!open) return null;

  const name = title || model?.name || "Serenity";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} Sovereign Presence`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex flex-col bg-black"
      data-sovereign-presence-stage
    >
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-5 pt-5 pointer-events-none">
        <div className="pointer-events-auto">
          <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-cyan-300/80">
            Sovereign Presence
          </p>
          <p className="font-mono text-sm text-cyan-100/90 mt-0.5">{name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto font-mono text-[10px] tracking-[0.25em] uppercase text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded px-3 py-1.5 transition-colors"
        >
          ✕ Exit
        </button>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <AnimaVessel4D
          model={model}
          expression={expression}
          autoRotate
          className="w-full h-full"
          layers={layers}
          sequences={sequences}
        />
      </div>

      <p className="absolute bottom-4 inset-x-0 text-center font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40 pointer-events-none">
        Drag to orbit · Scroll to zoom · 4D lattice active
      </p>
    </motion.div>
  );
}
