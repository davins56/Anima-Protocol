import { useState, useEffect } from "react";
import NetBattleArena from "@/components/battle/NetBattleArena";
import { base44 } from "@/api/base44Client";
import { track } from "@/lib/analytics";

export default function NetBattle() {
  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await base44.entities.Character.list("-created_date", 1);
        if (active && list?.length) {
          setCharacter(list[0]);
        }
      } catch (err) {
        console.warn("NetBattle character load failed:", err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleBattleComplete = (resultData) => {
    track("net_battle_completed", resultData || {});
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-[#05070f] text-cyan-100 min-h-screen">
      <div className="w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-mono uppercase tracking-widest text-cyan-400">
            NetBattle Matrix
          </h1>
          <span className="text-xs font-mono text-cyan-600 uppercase">
            Protocol Cyber-Combat Arena
          </span>
        </div>
        <div className="w-full border border-cyan-900/50 bg-[#090d18] rounded-lg overflow-hidden shadow-2xl">
          <NetBattleArena
            character={character}
            onBattleComplete={handleBattleComplete}
          />
        </div>
      </div>
    </div>
  );
}
