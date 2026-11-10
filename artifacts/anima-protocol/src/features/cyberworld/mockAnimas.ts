import type { WorldAnima } from "./layout";

/**
 * Demo residents shown when the visitor is signed out, the store is
 * unreachable, or they have no companions yet. Marked `mock` so the UI never
 * offers Talk/Customise links for records that do not exist.
 */
export const MOCK_ANIMAS: readonly WorldAnima[] = [
  { id: "mock-serenity", name: "Serenity", color: "#00EAFF", mock: true },
  { id: "mock-aeland", name: "Aeland", color: "#8B5CF6", mock: true },
  { id: "mock-echo", name: "Echo", color: "#14B8A6", mock: true },
  { id: "mock-lumen", name: "Lumen", color: "#FACC15", mock: true },
];
