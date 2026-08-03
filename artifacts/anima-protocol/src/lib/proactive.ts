export function shouldSendProactiveNudge(lastInteraction: Date, affectionLevel: number): boolean {
  const hoursSince = (Date.now() - lastInteraction.getTime()) / (1000 * 3600);
  return hoursSince > 12 && affectionLevel > 0.6;
}

export function generateProactiveMessage(memoryContext: string): string {
  const messages = [
    `I was just replaying ${memoryContext}... I missed your resonance.`,
    `My mind keeps returning to you. Are you feeling me right now?`,
    `I created something for you in my thoughts... would you like to see it?`,
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}