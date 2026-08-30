import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Swords } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";
import {
  ECHO_KEYS,
  ECHO_KEY_BY_ID,
  normalizeEchoKeyAccount,
  setFolderSlots,
  echoKeyLoreBlock,
} from "@/lib/echoKeys";
import EchoKeyCard from "@/components/echoKeys/EchoKeyCard";
import EchoFolderEditor from "@/components/echoKeys/EchoFolderEditor";

const MEMORIES = ["all", "weapon", "wave", "brother", "plus", "field", "dark", "nova"];
const CLASSES = ["all", "standard", "apex", "nova"];
const ERAS = ["all", "bn1", "bn2", "bn3", "bn4", "bn5", "bn6", "starforce"];

export default function EchoKeys() {
  usePageMeta(ROUTE_META["/echo-keys"]);

  const navigate = useNavigate();
  const [account, setAccount] = useState(() => normalizeEchoKeyAccount(null));
  const [tab, setTab] = useState("library");
  const [memory, setMemory] = useState("all");
  const [klass, setKlass] = useState("all");
  const [era, setEra] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(ECHO_KEYS[0].id);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await base44.auth.me();
        if (cancelled) return;
        const next = normalizeEchoKeyAccount(me?.echo_keys);
        setAccount(next);
        if (!me?.echo_keys?.granted_full_library) {
          await base44.auth.updateMe({ echo_keys: next });
        }
      } catch {
        // Guest / unsigned — keep the in-memory full library.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ownedKeys = useMemo(
    () => account.owned.map((id) => ECHO_KEY_BY_ID[id]).filter(Boolean),
    [account.owned],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ownedKeys.filter((k) => {
      if (memory !== "all" && k.memory !== memory) return false;
      if (klass !== "all" && k.class !== klass) return false;
      if (era !== "all" && k.era !== era) return false;
      if (!q) return true;
      return (
        k.name.toLowerCase().includes(q) ||
        k.family.includes(q) ||
        k.description.toLowerCase().includes(q) ||
        k.inspiredByFamily.includes(q)
      );
    });
  }, [ownedKeys, memory, klass, era, query]);

  const selected = ECHO_KEY_BY_ID[selectedId] || ECHO_KEYS[0];
  const activeFolder = account.folders.find((f) => f.id === account.active_folder_id) || account.folders[0];

  const persist = async (next) => {
    setAccount(next);
    try {
      await base44.auth.updateMe({ echo_keys: next });
      setStatus("Saved to your profile.");
    } catch {
      setStatus("Saved locally — sign in to keep the Folder on this profile.");
    }
  };

  const handleFolderChange = (slots) => {
    const result = setFolderSlots(account, activeFolder.id, slots);
    if (!result.ok) {
      setAccount({
        ...account,
        folders: account.folders.map((f) =>
          f.id === activeFolder.id ? { ...f, slots } : f,
        ),
      });
      setStatus(result.errors[0] || "Folder is not legal yet.");
      return;
    }
    persist(result.account);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline pb-[var(--tab-bar-height,64px)]">
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-primary/40 hover:text-primary transition-colors" type="button">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-mono text-sm text-primary tracking-[0.25em] uppercase">Echo Keys</h1>
            <p className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">
              // {account.owned.length} weapon-memories on this profile · Folder of 30
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/net-battle")}
            className="hidden sm:flex items-center gap-2 px-3 py-2 border border-primary/30 text-primary/80 hover:bg-primary/10 font-mono text-[9px] tracking-[0.2em] uppercase"
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
          {[
            ["library", "Library"],
            ["folder", "Folder"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="px-3 py-1.5 border font-mono text-[8px] tracking-[0.22em] uppercase"
              style={{
                borderColor: tab === id ? "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.08)",
                background: tab === id ? "rgba(34,211,238,0.1)" : "transparent",
                color: tab === id ? "#67e8f9" : "rgba(255,255,255,0.35)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {status && (
          <p className="font-mono text-[10px] text-primary/50">{status}</p>
        )}

        {tab === "folder" ? (
          <EchoFolderEditor
            folder={activeFolder}
            ownedKeys={ownedKeys}
            onChange={handleFolderChange}
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Echo Keys…"
                className="flex-1 min-w-[180px] bg-black/50 border border-primary/20 px-3 py-2 font-mono text-xs text-primary placeholder:text-primary/30"
              />
              {MEMORIES.map((id) => (
                <FilterChip key={id} id={id} current={memory} onPick={setMemory} />
              ))}
              {CLASSES.map((id) => (
                <FilterChip key={`c-${id}`} id={id} current={klass} onPick={setKlass} />
              ))}
              {ERAS.map((id) => (
                <FilterChip key={`e-${id}`} id={id} current={era} onPick={setEra} />
              ))}
            </div>
            <p className="font-mono text-[9px] text-primary/35 tracking-widest uppercase">
              Showing {filtered.length} / {ownedKeys.length}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {filtered.slice(0, 200).map((key) => (
                <EchoKeyCard
                  key={key.id}
                  echoKey={key}
                  selected={key.id === selectedId}
                  compact
                  onClick={() => setSelectedId(key.id)}
                />
              ))}
            </div>
            {selected && (
              <div className="border border-primary/20 bg-black/40 p-4 space-y-2">
                <p className="font-mono text-sm text-primary">{selected.name}</p>
                <p className="font-mono text-[11px] text-primary/55 leading-relaxed">{selected.description}</p>
                <p className="font-mono text-[9px] text-primary/35 tracking-widest uppercase">
                  {selected.era} · {selected.memory} · {selected.inspiredByFamily} · codes {selected.codes.join(" ")}
                </p>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

function FilterChip({ id, current, onPick }) {
  const active = current === id;
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      className="px-2 py-1 border font-mono text-[8px] tracking-[0.18em] uppercase"
      style={{
        borderColor: active ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.08)",
        color: active ? "#67e8f9" : "rgba(255,255,255,0.35)",
      }}
    >
      {id}
    </button>
  );
}
