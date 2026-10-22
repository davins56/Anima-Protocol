import { useState } from "react";
import { track } from "@/lib/analytics";
import { FREE_FEATURES, PAID_OFFERS, joinWaitlist, waitlistedOffers } from "@/lib/plans";

/**
 * Honest placeholder while payments are not live: no checkout, no card form.
 * "Join waitlist" records intent (subscription_upgrade_started) and remembers
 * the choice on this device.
 */
export default function ComingSoonWaitlist({ fromTier = "free" }) {
  const [joined, setJoined] = useState(() => waitlistedOffers());
  return (
    <section data-testid="plans-coming-soon" className="max-w-3xl mx-auto space-y-6 p-4">
      <header className="text-center space-y-2">
        <h1 className="font-mono text-2xl text-primary tracking-[0.15em] uppercase">Coming soon</h1>
        <p className="text-sm text-primary/70">
          Payments aren't live yet. Nothing will be charged. Join the waitlist and we'll tell you when it opens.
        </p>
      </header>
      <ul className="text-sm text-primary/80 space-y-1">
        {FREE_FEATURES.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      <div className="grid sm:grid-cols-3 gap-3">
        {PAID_OFFERS.map((offer) => {
          const isJoined = joined.includes(offer.id);
          return (
            <div key={offer.id} className="border border-primary/20 bg-black/30 p-4 space-y-3">
              <h2 className="font-mono text-sm uppercase tracking-widest text-primary">{offer.name}</h2>
              <p className="text-xs text-primary/60">{offer.blurb}</p>
              <button
                type="button"
                disabled={isJoined}
                onClick={() => {
                  track("subscription_upgrade_started", {
                    tier: offer.id,
                    purchase_type: "waitlist",
                    from_tier: fromTier,
                  });
                  setJoined(joinWaitlist(offer.id));
                }}
                className="w-full min-h-[44px] border border-primary/40 text-primary font-mono text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {isJoined ? "On the waitlist" : "Join waitlist"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
