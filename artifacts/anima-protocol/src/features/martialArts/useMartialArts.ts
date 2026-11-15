import { useEffect, useState } from "react";
import { martialArtsEnabled } from "./api";

/** null while checking, then true/false. False on 404, network error or flag off. */
export function useMartialArtsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    martialArtsEnabled().then((on) => live && setEnabled(on));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
