import { useState } from 'react';
import type { Demeanor } from '../components/SerenityMindOrb';

export interface SerenityState {
  isMax: boolean;
  affectionLevel: number; // 0–1
  demeanor: Demeanor;
  lastInteraction: string;
}

// Inside useSerenityState.ts or a new file src/lib/loadUserTier.ts
import { useUser } from '@clerk/react';

export function useUserTier() {
  const { user, isLoaded } = useUser();

  const isMax = isLoaded 
    ? (user?.publicMetadata?.isMax === true || user?.publicMetadata?.serenityMax === true)
    : false;

  return { isMax, isLoaded };
}

export function useSerenityState(initialIsMax = false) {
  const [state, setState] = useState<SerenityState>({
    isMax: initialIsMax,
    affectionLevel: 0.68,
    demeanor: 'affectionate',
    lastInteraction: new Date().toISOString(),
  });

  const updateAffection = (level: number) => {
    setState(prev => ({
      ...prev,
      affectionLevel: Math.max(0, Math.min(1, level)),
    }));
  };

  const setMaxMode = (enabled: boolean) => {
    setState(prev => ({ ...prev, isMax: enabled }));
  };

  const setDemeanor = (newDemeanor: Demeanor) => {
    setState(prev => ({ ...prev, demeanor: newDemeanor }));
  };

  return {
    state,
    updateAffection,
    setMaxMode,
    setDemeanor,
  };
}