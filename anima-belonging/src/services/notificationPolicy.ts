// Central gatekeeper for any notification/reminder copy in the app.
//
// Rule: reminders reference the WORK ("you left this scene unfinished"),
// never the user's ABSENCE or the app's need for them ("Serenity misses
// you", "don't lose your streak"). Route every notification through here
// before it's dispatched — anything that fails is blocked in dev with a
// console warning and silently dropped in production.

export interface NotificationRequest {
  title: string;
  body: string;
  reason: 'open-thread' | 'user-set-reminder' | 'milestone' | 'system';
}

const BANNED_PATTERNS: RegExp[] = [
  /miss(es|ing)? you/i,
  /streak/i,
  /don'?t (lose|break)/i,
  /come back/i,
  /it'?s been (a while|so long)/i,
  /we noticed you'?ve? (been )?away/i,
  /where (have|did) you (go|been)/i,
  /haven'?t (seen|heard from) you/i,
];

export function isPermissible(notification: NotificationRequest): boolean {
  const combined = `${notification.title} ${notification.body}`;
  const violatesTone = BANNED_PATTERNS.some(pattern => pattern.test(combined));

  if (violatesTone && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      `[notificationPolicy] Blocked notification for tone: "${combined}". ` +
        `Reminders should reference the work, not the user's absence.`
    );
  }

  return !violatesTone;
}

export function sendIfPermissible(
  notification: NotificationRequest,
  dispatch: (n: NotificationRequest) => void
): void {
  if (isPermissible(notification)) {
    dispatch(notification);
  }
}
