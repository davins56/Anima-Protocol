// @ts-check
import { useEffect, useRef } from 'react';

// Re-run a loader when another device changes this account's data.
//
// base44Client polls a cheap server "revision" token and dispatches a window
// `anima:store-changed` event when a remote change is detected (its own caches
// are already dropped at that point). Pages that show server-backed data call
// this hook with their existing load function so they refetch live, without a
// manual reload. Keep the loader cheap/idempotent — it can fire at any time the
// page is mounted.
/** @param {() => void} loadFn */
export function useStoreSync(loadFn) {
  const fnRef = useRef(loadFn);
  fnRef.current = loadFn;

  useEffect(() => {
    const handler = () => {
      fnRef.current?.();
    };
    window.addEventListener('anima:store-changed', handler);
    return () => window.removeEventListener('anima:store-changed', handler);
  }, []);
}

export default useStoreSync;