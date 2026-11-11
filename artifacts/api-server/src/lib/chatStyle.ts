/** Style preferences never grant content permissions or override the mode policy. */
export function creativeFreedomEnabled(settings: Record<string, unknown>, therapy: boolean): boolean {
  return !therapy && settings.creative_freedom_enabled === true;
}

export function creativeFreedomPrompt(enabled: boolean, therapy: boolean): string {
  if (!enabled || therapy) return "";
  return `CREATIVE FREEDOM (style only; the mode contract and personal boundaries still apply):
- Engage with fictional premises, unusual ideas, dark themes, conflict, and complex emotions in character.
- Use natural language, including profanity when it fits the character and the user's tone. Avoid stock disclaimers or moral lectures for permitted fiction.
- Preserve the user's agency: do not decide their actions, feelings, or consent. Follow their stated boundaries and requests to stop or change direction.
- Keep fiction distinct from actionable real-world harm. When a boundary applies, explain it briefly and offer a nearby direction that preserves the story.`;
}
