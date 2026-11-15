// Shared #765 group wire fixtures (docs/contracts/fixtures/emotions-group.v1.json).
import raw from "../../../../docs/contracts/fixtures/emotions-group.v1.json";

/** A fresh copy per call (tests may mutate it). */
export function groupEmotionFixtures() {
  return structuredClone(raw);
}
