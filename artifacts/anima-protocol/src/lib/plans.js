// @ts-check
/**
 * Paid add-ons. Text chat stays free. Shared by the plans page (waitlist now,
 * Stripe Checkout in feature/stripe-checkout) and analytics.
 */
export const PAID_OFFERS = [
  {
    id: "photo_credits",
    name: "Photo credits",
    blurb: "Moments and portraits from your companion.",
    purchase_type: "one_time",
  },
  {
    id: "voice_minutes",
    name: "Voice minutes",
    blurb: "Talk with her out loud.",
    purchase_type: "one_time",
  },
  {
    id: "deep_mode",
    name: "Deep mode",
    blurb: "Longer, more considered replies on the larger model.",
    purchase_type: "subscription",
  },
];

export const FREE_FEATURES = ["Text chat with your companions — always free", "Memories, companions and Home"];

const WAITLIST_KEY = "anima_plan_waitlist";

/** @returns {string[]} */
export function waitlistedOffers(store = safeStorage()) {
  try {
    const raw = JSON.parse(store?.getItem(WAITLIST_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** @param {string} offerId */
export function joinWaitlist(offerId, store = safeStorage()) {
  const next = Array.from(new Set([...waitlistedOffers(store), offerId]));
  try {
    store?.setItem(WAITLIST_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — the analytics event still records intent */
  }
  return next;
}

function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
