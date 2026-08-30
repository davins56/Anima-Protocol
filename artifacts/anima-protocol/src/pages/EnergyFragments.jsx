import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import FragmentLibrary from "@/components/energyFragments/FragmentLibrary";
import { ENERGY_FRAGMENTS, BN1_CHIP_FAMILIES } from "@/lib/energyFragments";

export default function EnergyFragments() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-primary/40 hover:text-primary transition-colors" type="button">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-sm text-primary tracking-[0.25em] uppercase">Energy Fragments</h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">
              // {ENERGY_FRAGMENTS.length} battle data · {BN1_CHIP_FAMILIES.length} chip families accounted
            </p>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto px-4 sm:px-6 py-8"
      >
        <p className="mb-6 text-[13px] text-primary/65 leading-relaxed max-w-3xl">
          Battle Chips from Mega Man Battle Network are the research baseline: Folder, letter codes,
          Standard / Mega / Giga caps, elemental cycle, Program Advances. Energy Fragments are new
          battle data — variations of those families plus original programs. When a fragment is
          slotted, the weapon arrives as an ethereal construct: glass-steel, afterimage, no mass.
          The research catalog stays here. Playable <button type="button" onClick={() => navigate("/echo-keys")} className="underline text-primary/80 hover:text-primary">Echo Keys</button> are crystallized harmonic instructions — the full Codex is in the Vault. A Resonance Array still slots only 30.
        </p>
        <FragmentLibrary />
      </motion.div>
    </div>
  );
}
