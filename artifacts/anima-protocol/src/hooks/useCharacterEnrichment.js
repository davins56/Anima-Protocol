// @ts-check
import { useEffect } from 'react';
import { animaClient } from '@/api/animaClient';

/**
 * @param {any[]} characters
 */
export function useCharacterEnrichment(characters) {
  useEffect(() => {
    if (!characters || characters.length === 0) return;

    // Enrich non-enriched characters from Wikipedia
    characters.forEach((/** @type {any} */ char) => {
      if (!char._enriched_at && !char._isAnima) {
        animaClient.functions.invoke('enrichCharacterFromWikipedia', {
          character_id: char.id,
          character_name: char.name,
          universe: char.universe,
        }).catch(() => {});
      }
    });
  }, [characters]);
}