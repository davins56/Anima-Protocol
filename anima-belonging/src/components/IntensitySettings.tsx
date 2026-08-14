// Lets the user set how deep the companion/lore layer goes, and gives
// direct, unambiguous control over notifications and memory resurfacing.
// No dark patterns: every option here defaults to what the copy says,
// and turning things off is exactly as easy as turning them on.

import { UserPreferences, Intensity } from '../types/belonging';

interface IntensitySettingsProps {
  preferences: UserPreferences;
  onChange: (next: UserPreferences) => void;
}

const INTENSITY_COPY: Record<Intensity, { label: string; description: string }> = {
  light: {
    label: 'Light',
    description: 'Serenity as a writing tool. Minimal in-character dialogue, no companion framing.',
  },
  balanced: {
    label: 'Balanced',
    description: 'A working creative partner with some personality. This is the default.',
  },
  deep: {
    label: 'Deep',
    description: 'Full companion and lore immersion, persistent relationship continuity.',
  },
};

export function IntensitySettings({ preferences, onChange }: IntensitySettingsProps) {
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Companion intensity
        </legend>
        <div className="mt-3 space-y-2">
          {(Object.keys(INTENSITY_COPY) as Intensity[]).map(level => (
            <label
              key={level}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 has-[:checked]:border-violet-400 has-[:checked]:bg-violet-50 dark:border-neutral-800 dark:has-[:checked]:border-violet-500/50 dark:has-[:checked]:bg-violet-500/10"
            >
              <input
                type="radio"
                name="intensity"
                value={level}
                checked={preferences.intensity === level}
                onChange={() => onChange({ ...preferences, intensity: level })}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {INTENSITY_COPY[level].label}
                </span>
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">
                  {INTENSITY_COPY[level].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Pick-up-where-you-left-off prompts
          </span>
          <span className="block text-sm text-neutral-500 dark:text-neutral-400">
            Surface open threads when you return. Off means no prompts at all — nothing tracked in the background either.
          </span>
        </span>
        <input
          type="checkbox"
          checked={preferences.allowMemoryResurfacing}
          onChange={e => onChange({ ...preferences, allowMemoryResurfacing: e.target.checked })}
          className="h-5 w-9 shrink-0"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Notifications
          </span>
          <span className="block text-sm text-neutral-500 dark:text-neutral-400">
            Only ever about the work — an unfinished scene, a milestone. Never about how long it's been.
          </span>
        </span>
        <input
          type="checkbox"
          checked={preferences.notificationsEnabled}
          onChange={e => onChange({ ...preferences, notificationsEnabled: e.target.checked })}
          className="h-5 w-9 shrink-0"
        />
      </label>
    </div>
  );
}
