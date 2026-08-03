import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export default function CharacterLoader({ onCharactersLoaded }) {
  useEffect(() => {
    loadAndEnrichCharacters();
  }, []);

  const loadAndEnrichCharacters = async () => {
    try {
      const [chars, animas] = await Promise.all([
        base44.entities.Character.list("-created_date", 500),
        base44.entities.Anima.list("-created_date", 100),
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
          base44.functions.invoke("enrichCharacterFromWikipedia", {
            character_id: char.id,
            character_name: char.name,
            universe: char.universe,
          }).catch(() => {});
        }
      });

      // Auto-assign voice profiles
      base44.functions.invoke("autoAssignCharacterVoices", {}).catch(() => {});
    } catch (err) {
      console.error('Error loading characters:', err);
      onCharactersLoaded([]);
    }
  };

  return null;
}