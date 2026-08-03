import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useCharacterEnrichment(characters) {
  useEffect(() => {
    if (!characters || characters.length === 0) return;

    // Enrich non-enriched characters from Wikipedia
    characters.forEach((char) => {
      if (!char._enriched_at && !char._isAnima) {
        base44.functions.invoke('enrichCharacterFromWikipedia', {
          character_id: char.id,
          character_name: char.name,
          universe: char.universe,
        }).catch(() => {});
      }
    });
  }, [characters]);
}