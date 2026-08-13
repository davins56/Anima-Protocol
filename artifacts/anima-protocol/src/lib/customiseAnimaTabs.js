/** Tab ids for the Customise Anima hub (`/customise-anima?tab=`). */
export const CUSTOMISE_ANIMA_TABS = [
  "look",
  "personality",
  "soulprint",
  "expression",
  "voice",
];

export function normalizeCustomiseAnimaTab(raw) {
  const id = String(raw || "").toLowerCase();
  return CUSTOMISE_ANIMA_TABS.includes(id) ? id : "look";
}
