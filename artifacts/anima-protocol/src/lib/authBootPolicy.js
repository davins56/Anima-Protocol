/**
 * Boot-time auth policy for Clerk vs Instant Sandbox / Guest Access.
 *
 * Guest is an explicit, this-session opt-in. A leftover
 * `anima_local_auth_user` in localStorage must never look like a signed-in
 * Clerk account and must never skip the login screen on a cold visit.
 */

export const LOCAL_AUTH_STORAGE_KEY = "anima_local_auth_user";
export const GUEST_CHOSEN_SESSION_KEY = "anima_guest_chosen";

export function isGuestIdentity(identity) {
  if (!identity || typeof identity !== "object") return false;
  return identity.is_guest === true || identity.auth_source === "guest";
}

export function markGuestIdentity(identity) {
  if (!identity || typeof identity !== "object") return null;
  return { ...identity, is_guest: true, auth_source: "guest" };
}

export function readPersistedGuest(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LOCAL_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function readExplicitGuestChosen(storage = globalThis.sessionStorage) {
  try {
    return storage?.getItem?.(GUEST_CHOSEN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistExplicitGuest(identity, {
  localStorage: localStore = globalThis.localStorage,
  sessionStorage: sessionStore = globalThis.sessionStorage,
} = {}) {
  const marked = markGuestIdentity(identity);
  try {
    sessionStore?.setItem?.(GUEST_CHOSEN_SESSION_KEY, "1");
  } catch {
    /* private mode */
  }
  try {
    if (marked) {
      localStore?.setItem?.(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(marked));
    }
  } catch {
    /* quota / private mode */
  }
  return marked;
}

export function clearGuestPersistence({
  localStorage: localStore = globalThis.localStorage,
  sessionStorage: sessionStore = globalThis.sessionStorage,
} = {}) {
  try {
    localStore?.removeItem?.(LOCAL_AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStore?.removeItem?.(GUEST_CHOSEN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Clerk / network failures on the sign-in form must not silently enter Guest.
 * The user has to tap Instant Sandbox / Guest Access.
 */
export function shouldEnterGuestOnSignInFailure() {
  return false;
}

/**
 * Decide boot mode once Clerk has reported its session state.
 *
 * @param {{
 *   clerkLoaded?: boolean,
 *   clerkSignedIn?: boolean,
 *   clerkUser?: { id?: string } | null,
 *   persistedGuest?: object | null,
 *   explicitGuestChosen?: boolean,
 * }} input
 * @returns {{
 *   mode: 'loading' | 'signed-in' | 'guest' | 'signed-out',
 *   identity: object | null,
 *   isSignedInUser: boolean,
 *   isGuest: boolean,
 * }}
 */
export function resolveAuthBoot({
  clerkLoaded = false,
  clerkSignedIn = false,
  clerkUser = null,
  persistedGuest = null,
  explicitGuestChosen = false,
} = {}) {
  if (!clerkLoaded) {
    return {
      mode: "loading",
      identity: null,
      isSignedInUser: false,
      isGuest: false,
    };
  }

  if (clerkSignedIn && clerkUser?.id) {
    return {
      mode: "signed-in",
      identity: clerkUser,
      isSignedInUser: true,
      isGuest: false,
    };
  }

  if (explicitGuestChosen && persistedGuest) {
    return {
      mode: "guest",
      identity: markGuestIdentity(persistedGuest),
      isSignedInUser: false,
      isGuest: true,
    };
  }

  return {
    mode: "signed-out",
    identity: null,
    isSignedInUser: false,
    isGuest: false,
  };
}
