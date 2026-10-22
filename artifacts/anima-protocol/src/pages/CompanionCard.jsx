import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ShareCompanionCard from "@/components/companions/ShareCompanionCard";

/** /companions/:characterId/card — identity-only share card for one companion. */
export default function CompanionCard() {
  const { characterId = "" } = useParams();
  const [character, setCharacter] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      for (const entity of ["Character", "Anima"]) {
        const rows = await base44.entities[entity].filter({ id: characterId }, undefined, 1).catch(() => []);
        if (rows?.[0]) {
          if (live) setCharacter(rows[0]);
          return;
        }
      }
      if (live) setMissing(true);
    })();
    return () => {
      live = false;
    };
  }, [characterId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 max-w-xl mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <Link to="/animas" className="text-primary/60 hover:text-primary" aria-label="Back to companions">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="font-mono text-lg text-primary tracking-[0.2em] uppercase">Companion card</h1>
      </header>
      {missing && <p className="text-sm text-primary/60">Couldn't find that companion.</p>}
      {character && <ShareCompanionCard character={character} vessel={character.vessel} />}
    </div>
  );
}
