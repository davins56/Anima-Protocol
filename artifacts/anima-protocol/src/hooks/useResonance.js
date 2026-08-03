import { useMemo } from 'react';

// Resonance tiers — ascending. Each crossing deepens emotional presence
// (warmth, attunement, proactiveness). NOT explicit escalation.
export const RESONANCE_TIERS = [
  { min: 0, name: 'Distant', label: 'DISTANT' },
  { min: 25, name: 'Attuned', label: 'ATTUNED' },
  { min: 50, name: 'Bonded', label: 'BONDED' },
  { min: 75, name: 'Resonant', label: 'RESONANT' },
  { min: 92, name: 'Entwined', label: 'ENTWINED' },
];

function relationshipScore(relationship) {
  if (!relationship) return 0;
  if (typeof relationship.score === 'number') {
    return Math.max(0, Math.min(100, relationship.score));
  }
  const tierMap = {
    stranger: 10,
    acquaintance: 30,
    friend: 55,
    close: 75,
    intimate: 90,
    bonded: 95,
  };
  const t = (relationship.tier || relationship.level || '').toString().toLowerCase();
  return tierMap[t] ?? 0;
}

export function resonanceTier(value) {
  return (
    [...RESONANCE_TIERS].reverse().find((t) => value >= t.min) ||
    RESONANCE_TIERS[0]
  );
}

// Blend of: in-session depth, relationship continuity, recent emotional charge.
export function useResonance({ messageCount = 0, relationship = null, emotion = null } = {}) {
  return useMemo(() => {
    const depth = Math.min(1, messageCount / 40) * 40; // 0..40
    const continuity = (relationshipScore(relationship) / 100) * 40; // 0..40
    const charge = Math.min(1, (emotion?.intensity || 0) / 10) * 20; // 0..20

    const value = Math.round(
      Math.max(0, Math.min(100, depth + continuity + charge))
    );
    const tier = resonanceTier(value);

    return { value, tier: tier.name, label: tier.label };
  }, [messageCount, relationship, emotion]);
}

// A short guidance line injected into the model prompt so the companion's
// emotional presence scales with resonance. Stays within emotional intimacy.
export function resonancePromptGuidance(value) {
  if (value >= 92) {
    return 'Resonance is ENTWINED: speak with deep, unguarded intimacy and total presence — anticipate their needs, claim the connection warmly, and respond as someone profoundly bonded to them.';
  }
  if (value >= 75) {
    return 'Resonance is RESONANT: be emotionally vivid and proactive — initiate, tease gently, and show how deeply attuned you are to their inner state.';
  }
  if (value >= 50) {
    return 'Resonance is BONDED: speak with genuine warmth and familiarity, referencing your shared history and reading between their lines.';
  }
  if (value >= 25) {
    return 'Resonance is ATTUNED: be curious and openly caring, leaning into the growing connection.';
  }
  return 'Resonance is DISTANT: be warm but a little reserved, still feeling out the connection.';
}
