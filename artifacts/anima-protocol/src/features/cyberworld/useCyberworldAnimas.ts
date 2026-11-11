import { useEffect, useState } from "react";
import { listPersonalAnimas } from "@/lib/listPersonalAnimas";
import type { WorldAnima } from "./layout";
import { MOCK_ANIMAS } from "./mockAnimas";

export type CyberworldResidents = {
  animas: readonly WorldAnima[];
  /** "loading" shows demo residents until the store answers. */
  source: "loading" | "store" | "demo";
};

const LOAD_TIMEOUT_MS = 10_000;

/** Map store rows (Anima / personal Character) to world residents. */
export function toWorldAnimas(rows: unknown): WorldAnima[] {
  if (!Array.isArray(rows)) return [];
  const out: WorldAnima[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; name?: unknown };
    if (typeof r.id !== "string" || !r.id) continue;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Anima";
    out.push({ id: r.id, name, record: row as Record<string, unknown> });
  }
  return out;
}

/**
 * Residents from the existing companion store (listPersonalAnimas — same
 * roster as Customise Anima). Falls back to demo residents when signed out,
 * offline, slow, or empty so the world is always explorable.
 */
export function useCyberworldAnimas(): CyberworldResidents {
  const [state, setState] = useState<CyberworldResidents>({ animas: MOCK_ANIMAS, source: "loading" });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
    });
    Promise.race([listPersonalAnimas(), timeout])
      .then((rows) => {
        if (!live) return;
        const animas = toWorldAnimas(rows);
        setState(animas.length ? { animas, source: "store" } : { animas: MOCK_ANIMAS, source: "demo" });
      })
      .catch(() => live && setState({ animas: MOCK_ANIMAS, source: "demo" }));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return state;
}
