// @ts-check
import { useEffect, useCallback } from 'react';
import { animaClient } from '@/api/animaClient';
import { whenBootstrapReady } from '@/lib/syncBootstrap';
import { useStoreSync } from '@/lib/useStoreSync';

/** @param {{ onCharactersLoaded: (...args: any[]) => void }} props */
export default function CharacterLoader({ onCharactersLoaded }) {
  const loadAndEnrichCharacters = useCallback(async () => {
    try {
      const [chars, animas] = await Promise.all([
        animaClient.entities.Character.list("-created_date", 500),
        animaClient.entities.Anima.list("-created_date", 100),
      ]);

      const enhancedChars = chars || [];
      const animaAsChars = (animas || []).map((a) => ({
        ...a,
        _isAnima: true,
        category: a.archetype || "guardian",
        universe: "Anima",
      }));

      const allChars = [...animaAsChars, ...enhancedChars];
      onCharactersLoaded(allChars);

      // Enrich non-enriched characters from Wikipedia in background
      allChars.forEach((char) => {
        if (!char._enriched_at && !char._isAnima) {
          animaClient.functions.invoke("enrichCharacterFromWikipedia", {
            character_id: char.id,
            character_name: char.name,
            universe: char.universe,
          }).catch(() => {});
        }
      });

      // Auto-assign voice profiles
      animaClient.functions.invoke("autoAssignCharacterVoices", {}).catch(() => {});
    } catch (err) {
      console.error('Error loading characters:', err);
      onCharactersLoaded([]);
    }
  }, [onCharactersLoaded]);

  useEffect(() => {
    let cancelled = false;
    whenBootstrapReady().then(() => {
      if (!cancelled) loadAndEnrichCharacters();
    });
    return () => {
      cancelled = true;
    };
  }, [loadAndEnrichCharacters]);

  useStoreSync(loadAndEnrichCharacters);

  return null;
}