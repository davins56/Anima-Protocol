// @ts-check
/**
 * Paid add-ons. Text chat stays free. Server catalog (api lib/billing/catalog.ts)
 * owns prices and units; this is display copy plus the waitlist fallback used
 * when billing is not configured.
 */
export const PAID_OFFERS = [
  { id: "photo_credits", name: "Photo credits", blurb: "Moments and portraits from your companion." },
  { id: "voice_minutes", name: "Voice minutes", blurb: "Talk with her out loud." },
  { id: "deep_mode", name: "Deep mode", blurb: "Longer, more considered replies on the larger model. 30-day pass." },
];

export const FREE_FEATURES = ["Text chat with your companions — always free", "Memories, companions and Home"];

const WAITLIST_KEY = "anima_plan_waitlist";

/**
 * Merge server status into display offers.
 * @param {{ enabled?: boolean, offers?: Array<{ id: string, units?: number, unit_label?: string, available?: boolean }> } | null} status
 */
export function offersWithStatus(status) {
  const byId = new Map((status?.offers || []).map((o) => [o.id, o]));
  return PAID_OFFERS.map((o) => {
    const s = byId.get(o.id);
    return {
      ...o,
      units: s?.units ?? null,
      unitLabel: s?.unit_label ?? null,
      purchasable: Boolean(status?.enabled && s?.available),
    };
  });
}

/** @param {string} search */
export function checkoutReturnState(search) {
  const v = new URLSearchParams(search || "").get("checkout");
  return v === "success" || v === "cancelled" ? v : null;
}

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
