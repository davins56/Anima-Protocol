/**
 * Clerk → base44 identity mapping and session-clear policy.
 *
 * Settings and most of the app read `base44.auth.me()`, which overlays this
 * in-memory Clerk identity on the server profile. If identity is missing, the
 * Account fields render as "—" even while Clerk `<SignedIn>` shows Home.
 */

/**
 * First usable email on a Clerk user. GitHub/OAuth accounts often have no
 * `primaryEmailAddress` until Clerk finishes hydrating, but still list one
 * under `emailAddresses`.
 *
 * @param {object | null | undefined} clerkUser
 * @returns {string}
 */
export function clerkEmailFromUser(clerkUser) {
  if (!clerkUser || typeof clerkUser !== "object") return "";
  const primary = clerkUser.primaryEmailAddress?.emailAddress;
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  const listed = clerkUser.emailAddresses;
  if (Array.isArray(listed)) {
    for (const entry of listed) {
      const address = entry?.emailAddress;
      if (typeof address === "string" && address.trim()) return address.trim();
    }
  }
  return "";
}

/**
 * Display name for Settings / profile. Never return empty when Clerk has a
 * session — a blank full_name is what Settings treats as signed-out.
 *
 * @param {object | null | undefined} clerkUser
 * @returns {string}
 */
export function clerkDisplayNameFromUser(clerkUser) {
  if (!clerkUser || typeof clerkUser !== "object") return "Seeker";
  const candidates = [
    clerkUser.fullName,
    clerkUser.username,
    clerkUser.firstName,
    clerkEmailFromUser(clerkUser).split("@")[0],
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Seeker";
}

/**
 * Identity payload for `base44.auth.syncIdentity`.
 *
 * @param {object | null | undefined} clerkUser
 * @returns {null | {
 *   id: string,
 *   email: string,
 *   username: string,
 *   full_name: string,
 *   github: string,
 *   externalAccounts: Array<{ provider?: string, username?: string }>,
 * }}
 */
export function clerkIdentityFromUser(clerkUser) {
  if (!clerkUser?.id) return null;
  const email = clerkEmailFromUser(clerkUser);
  const username =
    typeof clerkUser.username === "string" ? clerkUser.username : "";
  return {
    id: clerkUser.id,
    email,
    username,
    full_name: clerkDisplayNameFromUser(clerkUser),
    github: username,
    externalAccounts: (clerkUser.externalAccounts || []).map((acc) => ({
      provider: acc.provider,
      username: acc.username,
    })),
  };
}

/**
 * Whether AuthContext may wipe the in-memory base44 identity.
 *
 * Must stay false while Clerk reports a session (`isSignedIn`) even if the
 * user object is still hydrating, and while a handshake / just-returned
 * sign-in may still mint cookies. Clearing in those windows is the
 * "Home signed-in, Settings blank" race.
 *
 * @param {{
 *   isSignedIn?: boolean,
 *   hasLocalUser?: boolean,
 *   pendingHandshake?: boolean,
 *   clerkAuthReturn?: boolean,
 * }} [input]
 * @returns {boolean}
 */
/**
 * First-load sign-up detection. `auth.me()` without a store token returns
 * Clerk identity and no `display_name` — that must not count as a new
 * account or we call `updateMe()` (401) and never retry.
 *
 * @param {{ display_name?: string } | null | undefined} profile
 * @param {boolean} storeReady
 * @returns {boolean}
 */
export function isNewStoreAccount(profile, storeReady) {
  return !!storeReady && !profile?.display_name;
}

export function shouldClearLocalSession({
  isSignedIn = false,
  hasLocalUser = false,
  pendingHandshake = false,
  clerkAuthReturn = false,
} = {}) {
  if (pendingHandshake || clerkAuthReturn) return false;
  if (isSignedIn) return false;
  if (hasLocalUser) return false;
  return true;
}
