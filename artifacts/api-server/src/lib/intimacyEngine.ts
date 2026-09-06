import type { IntimacyProfile } from "./intimacyTypes";

/**
 * Decays intimacy heat over idle time in minutes.
 * Heat decays towards 0 if idle for extended periods.
 */
export function decayHeat(profile: IntimacyProfile, idleMinutes: number): IntimacyProfile {
  if (!profile.heat || profile.heat <= 0) return profile;

  // Rate: lose ~5 heat every 15 minutes of idle time
  const decayAmount = Math.floor(idleMinutes / 15) * 5;
  const newHeat = Math.max(0, profile.heat - decayAmount);

  return {
    ...profile,
    heat: newHeat,
  };
}
