import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import EchoKeyVault from "@/components/echoKeys/EchoKeyVault";
import useEchoLibrary from "@/hooks/useEchoLibrary";
import { ECHO_KEYS, ECHO_FAMILIES } from "@/lib/echoKeys";

export default function EchoKeys() {
  const navigate = useNavigate();
  const { library, persist, resetFolder, saving, error } = useEchoLibrary();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-amber-300/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="text-primary/40 hover:text-primary transition-colors"
            type="button"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-mono text-sm text-amber-200 tracking-[0.25em] uppercase">
              Echo Keys
            </h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">
              // {ECHO_KEYS.length} weapon-memories · {ECHO_FAMILIES.length} families · profile library
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/net-battle")}
            className="hidden sm:block px-3 py-1.5 border border-amber-300/30 font-mono text-[8px] tracking-[0.2em] uppercase text-amber-100 hover:bg-amber-950/30"
          >
            Jack into NetBattle
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto px-4 sm:px-6 py-8"
      >
        <p className="mb-6 text-[13px] text-primary/65 leading-relaxed max-w-3xl">
          Echo Keys are the memory of weapons. This profile holds the full library —
          about eight hundred distinct keys remixed from Battle Chip families across
          Mega Man Battle Network 1–6 (every version) and the Star Force Battle Card
          system. Slot thirty into a Folder, pin a Regular and a Star-Force card, then
          jack in. Summoned weapons arrive as ethereal constructs: glass-steel, afterimage, no mass.
        </p>
        <EchoKeyVault
          library={library}
          onSave={persist}
          onReset={resetFolder}
          saving={saving}
          error={error}
        />
      </motion.div>
    </div>
  );
}
