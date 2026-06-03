// Mixpanel analytics — single source of truth for product analytics.
//
// Why a wrapper instead of importing mixpanel-browser directly in feature files:
//   * One place to initialize (never multiple instances).
//   * Consent gating lives here — EU/UK/CA users are opted OUT by default and only
//     start sending data after they explicitly accept (see ConsentBanner.jsx).
//   * Every call is a no-op when the token is missing, so the app never breaks if
//     analytics is unconfigured (e.g. local forks without VITE_MIXPANEL_TOKEN).
//
// Read AGENTS.md ("Analytics Tracking — Mixpanel") before adding new events.

import mixpanel from 'mixpanel-browser';

const TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN;
const IS_PROD = import.meta.env.PROD;

let initialized = false;

// Guard every public function so feature code can call analytics unconditionally.
function ready() {
  return initialized && !!TOKEN;
}

// Initialize once at app startup (called from main.jsx). Tracking is disabled by
// default — nothing is sent until the user grants consent via grantConsent().
export function initAnalytics() {
  if (initialized) return;
  if (!TOKEN) {
    if (!IS_PROD) {
      console.warn(
        '[analytics] VITE_MIXPANEL_TOKEN not set — Mixpanel tracking disabled.',
      );
    }
    return;
  }

  mixpanel.init(TOKEN, {
    debug: !IS_PROD,
    // Consent gate: new users start opted-out (GDPR/CCPA). Returning users keep
    // whatever decision mixpanel persisted, so this does not re-prompt them.
    opt_out_tracking_by_default: true,
    persistence: 'localStorage',
    // We track meaningful user actions explicitly, not raw page views.
    track_pageview: false,
    // Mixpanel's Simplified ID Merge (default) stitches anonymous + identified
    // sessions, so we never set distinct_id by hand.
  });

  initialized = true;
}

// --- Consent (EU/UK/CA) -----------------------------------------------------

// True once the user has accepted analytics.
export function hasConsented() {
  return ready() && mixpanel.has_opted_in_tracking();
}

// True once the user has explicitly declined analytics.
export function hasDeclined() {
  return ready() && mixpanel.has_opted_out_tracking();
}

// True when we still need to ask (no decision recorded yet).
export function needsConsentDecision() {
  return ready() && !hasConsented() && !hasDeclined();
}

// Call only after the user explicitly accepts — not on banner dismissal.
export function grantConsent() {
  if (!ready()) return;
  mixpanel.opt_in_tracking();
}

// Call when the user declines or withdraws consent. Clears stored user data.
export function revokeConsent() {
  if (!ready()) return;
  mixpanel.opt_out_tracking();
}

// --- Identity ---------------------------------------------------------------

// Link the current session to a stable internal user id. Never pass an email.
export function identifyUser(userId) {
  if (!ready() || !userId) return;
  mixpanel.identify(String(userId));
}

// Profile attributes describe the *user* (not an action). Set after identify().
export function setProfile(props) {
  if (!ready() || !props) return;
  mixpanel.people.set(props);
}

// Profile attributes that should only ever be written once (e.g. first sign-up).
export function setProfileOnce(props) {
  if (!ready() || !props) return;
  mixpanel.people.set_once(props);
}

// Super properties are attached to every subsequent event automatically.
export function registerSuper(props) {
  if (!ready() || !props) return;
  mixpanel.register(props);
}

// Clear identity on logout so the next user on this device starts fresh.
export function resetUser() {
  if (!ready()) return;
  mixpanel.reset();
}

// --- Events -----------------------------------------------------------------

// Track a product event. No-op until initialized + consent granted (mixpanel
// drops events while opted-out, so this is safe to call unconditionally).
export function track(eventName, props) {
  if (!ready()) return;
  mixpanel.track(eventName, props);
}
