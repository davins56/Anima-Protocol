import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clearGuestPersistence,
  isGuestIdentity,
  markGuestIdentity,
  persistExplicitGuest,
  readExplicitGuestChosen,
  readPersistedGuest,
  resolveAuthBoot,
  shouldEnterGuestOnSignInFailure,
} from "./authBootPolicy";

const leftoverGuest = {
  id: "user_seeker",
  email: "seeker@anima-protocol.com",
  full_name: "Seeker",
};

const clerkUser = {
  id: "user_2realClerkAccount",
  email: "davins56@hotmail.com",
  full_name: "Dàvīn Smith",
};

describe("resolveAuthBoot", () => {
  it("does not auto-guest while Clerk is still loading, even with leftover local guest", () => {
    const boot = resolveAuthBoot({
      clerkLoaded: false,
      clerkSignedIn: false,
      clerkUser: null,
      persistedGuest: leftoverGuest,
      explicitGuestChosen: false,
    });
    expect(boot.mode).toBe("loading");
    expect(boot.isGuest).toBe(false);
    expect(boot.isSignedInUser).toBe(false);
    expect(boot.identity).toBeNull();
  });

  it("does not auto-guest when a Clerk session is missing and Guest was not chosen", () => {
    const boot = resolveAuthBoot({
      clerkLoaded: true,
      clerkSignedIn: false,
      clerkUser: null,
      persistedGuest: leftoverGuest,
      explicitGuestChosen: false,
    });
    expect(boot.mode).toBe("signed-out");
    expect(boot.isGuest).toBe(false);
    expect(boot.isSignedInUser).toBe(false);
    expect(boot.identity).toBeNull();
  });

  it("does not treat an explicit guest as the signed-in user", () => {
    const boot = resolveAuthBoot({
      clerkLoaded: true,
      clerkSignedIn: false,
      clerkUser: null,
      persistedGuest: leftoverGuest,
      explicitGuestChosen: true,
    });
    expect(boot.mode).toBe("guest");
    expect(boot.isGuest).toBe(true);
    expect(boot.isSignedInUser).toBe(false);
    expect(isGuestIdentity(boot.identity)).toBe(true);
    expect(boot.identity.id).toBe("user_seeker");
  });

  it("prefers a real Clerk session over leftover guest storage", () => {
    const boot = resolveAuthBoot({
      clerkLoaded: true,
      clerkSignedIn: true,
      clerkUser,
      persistedGuest: leftoverGuest,
      explicitGuestChosen: true,
    });
    expect(boot.mode).toBe("signed-in");
    expect(boot.isSignedInUser).toBe(true);
    expect(boot.isGuest).toBe(false);
    expect(boot.identity).toEqual(clerkUser);
    expect(isGuestIdentity(boot.identity)).toBe(false);
  });

  it("stays signed-out when Guest was chosen but no guest identity exists", () => {
    const boot = resolveAuthBoot({
      clerkLoaded: true,
      clerkSignedIn: false,
      persistedGuest: null,
      explicitGuestChosen: true,
    });
    expect(boot.mode).toBe("signed-out");
    expect(boot.isGuest).toBe(false);
  });
});

describe("shouldEnterGuestOnSignInFailure", () => {
  it("never auto-enters Guest because Clerk is loading or unreachable", () => {
    expect(shouldEnterGuestOnSignInFailure()).toBe(false);
  });
});

describe("guest persistence helpers", () => {
  it("restores leftover local guest only after an explicit this-session choice", () => {
    const localStorage = new Map();
    const sessionStorage = new Map();
    const storage = (map) => ({
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => {
        map.set(key, String(value));
      },
      removeItem: (key) => {
        map.delete(key);
      },
    });

    persistExplicitGuest(leftoverGuest, {
      localStorage: storage(localStorage),
      sessionStorage: storage(sessionStorage),
    });

    expect(readExplicitGuestChosen(storage(sessionStorage))).toBe(true);
    expect(isGuestIdentity(readPersistedGuest(storage(localStorage)))).toBe(true);

    clearGuestPersistence({
      localStorage: storage(localStorage),
      sessionStorage: storage(sessionStorage),
    });
    expect(readExplicitGuestChosen(storage(sessionStorage))).toBe(false);
    expect(readPersistedGuest(storage(localStorage))).toBeNull();
  });

  it("marks guest identities so they cannot be mistaken for Clerk users", () => {
    expect(isGuestIdentity(leftoverGuest)).toBe(false);
    expect(isGuestIdentity(markGuestIdentity(leftoverGuest))).toBe(true);
    expect(isGuestIdentity(clerkUser)).toBe(false);
  });
});

describe("boot wiring", () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  it("does not restore leftover guest from localStorage on AuthProvider first paint", () => {
    const auth = readFileSync(join(srcRoot, "lib/AuthContext.jsx"), "utf8");
    expect(auth).not.toMatch(
      /useState\(\(\)\s*=>\s*\{[\s\S]*anima_local_auth_user/,
    );
    expect(auth).toMatch(/useState\(null\)/);
    expect(auth).toMatch(/resolveAuthBoot/);
    expect(auth).toMatch(/isSignedInUser/);
    expect(auth).toContain("const isLoadingAuth = !isLoaded");
  });

  it("gates sign-in failure fallbacks so Guest is never entered automatically", () => {
    const signIn = readFileSync(
      join(srcRoot, "components/auth/EmailCodeSignIn.jsx"),
      "utf8",
    );
    expect(signIn).toMatch(/shouldEnterGuestOnSignInFailure/);
    const unguarded =
      /if \(!signIn \|\| typeof signIn\.create !== "function"\) \{\s*handleInstantGuest/;
    expect(signIn).not.toMatch(unguarded);
    expect(signIn).toMatch(/isSignedInUser \|\| isGuest/);
  });

  it("HomeGate enters the app only for Clerk or explicit guest", () => {
    const app = readFileSync(join(srcRoot, "ProtocolApp.jsx"), "utf8");
    expect(app).toMatch(/isSignedInUser \|\| isGuest \|\| isAuthenticated/);
    expect(app).not.toMatch(/if \(isAuthenticated \|\| localUser \|\| user\)/);
    expect(app).not.toMatch(/will load in guest mode/);
  });
});
