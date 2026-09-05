import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Swords } from "lucide-react";
import { motion } from "framer-motion";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";
import useEchoLibrary from "@/hooks/useEchoLibrary";
import {
  ECHO_KEY_BY_ID,
  accountToLibrary,
  echoKeyLoreBlock,
  enrichEchoKey,
  normalizeEchoKeyAccount,
} from "@/lib/echoKeys";
import EchoKeyVault from "@/components/echoKeys/EchoKeyVault";
import EchoStoryMode from "@/components/echoKeys/EchoStoryMode";
import EchoCodex from "@/components/echoKeys/EchoCodex";

const TABS = [
  ["story", "Story"],
  ["vault", "Vault"],
  ["loadout", "Loadout"],
  ["codex", "Codex"],
];

export default function EchoKeys() {
  usePageMeta(ROUTE_META["/echo-keys"]);
  const navigate = useNavigate();
  const { library, persist, resetFolder, saving, error } = useEchoLibrary();
  const [tab, setTab] = useState("story");
  const account = useMemo(() => normalizeEchoKeyAccount(library), [library]);
  const ownedKeys = useMemo(
    () => account.owned.map((id) => enrichEchoKey(ECHO_KEY_BY_ID[id])).filter(Boolean),
    [account.owned],
  );

  const persistAccount = (next) => persist(accountToLibrary(next));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-amber-300/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
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
              // {account.owned.length} in Vault · Codex · Array {library.folder?.length || 0}/30
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/net-battle")}
            className="hidden sm:flex items-center gap-2 px-3 py-2 border border-amber-300/30 text-amber-100 hover:bg-amber-950/30 font-mono text-[8px] tracking-[0.2em] uppercase"
          >
            <Swords className="w-3.5 h-3.5" />
            Jack in
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6"
      >
        <p className="text-[13px] text-primary/65 leading-relaxed max-w-3xl">
          {echoKeyLoreBlock()}
        </p>

        <div className="flex flex-wrap gap-2">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="px-3 py-1.5 border font-mono text-[8px] tracking-[0.22em] uppercase"
              style={{
                borderColor: tab === id ? "rgba(251,191,36,0.45)" : "rgba(255,255,255,0.08)",
                background: tab === id ? "rgba(251,191,36,0.08)" : "transparent",
                color: tab === id ? "#fde68a" : "rgba(255,255,255,0.35)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "story" ? (
          <EchoStoryMode account={account} ownedKeys={ownedKeys} onAccount={persistAccount} />
        ) : tab === "codex" ? (
          <EchoCodex ownedIds={account.owned} />
        ) : (
          <EchoKeyVault
            library={library}
            onSave={persist}
            onReset={resetFolder}
            saving={saving}
            error={error}
            ownedOnly={tab === "vault"}
          />
        )}
      </motion.div>
    </div>
  );
}
