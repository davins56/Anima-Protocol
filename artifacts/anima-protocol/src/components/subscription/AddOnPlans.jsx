import { useEffect, useState } from "react";
import { animaApi } from "@/api/animaApi";
import { track } from "@/lib/analytics";
import {
  FREE_FEATURES,
  checkoutReturnState,
  joinWaitlist,
  offersWithStatus,
  waitlistedOffers,
} from "@/lib/plans";

/**
 * Paid add-ons via Stripe Checkout (test mode). The server picks prices and
 * fulfils only from the signed webhook; this page just redirects. Offers the
 * server can't sell yet fall back to an honest waitlist.
 */
export default function AddOnPlans({ fromTier = "free", api = animaApi, redirect = (url) => window.location.assign(url) }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(() => waitlistedOffers());
  const returned = checkoutReturnState(typeof window !== "undefined" ? window.location.search : "");

  useEffect(() => {
    let live = true;
    api.billing
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus({ enabled: false, offers: [] }));
    return () => {
      live = false;
    };
  }, [api]);

  const offers = offersWithStatus(status);
  const balances = status?.balances;

  const buy = async (offer) => {
    setError("");
    setBusy(offer.id);
    track("subscription_upgrade_started", { tier: offer.id, purchase_type: "one_time", from_tier: fromTier });
    try {
      const { url } = await api.billing.checkout(offer.id);
      if (!url) throw new Error("No checkout url");
      redirect(url);
    } catch (err) {
      setError(err?.status === 401 ? "Sign in to buy add-ons." : "Couldn't start checkout. Please try again.");
      setBusy(null);
    }
  };

  return (
    <section data-testid="add-on-plans" className="max-w-3xl mx-auto space-y-6 p-4">
      <header className="text-center space-y-2">
        <h1 className="font-mono text-2xl text-primary tracking-[0.15em] uppercase">Add-ons</h1>
        <p className="text-sm text-primary/70">
          Text chat is free. Add photos, voice, or deep mode when you want them.
        </p>
        {status?.test_mode && status?.enabled && (
          <p data-testid="test-mode-note" className="text-xs text-amber-300/80">
            Test mode: use a Stripe test card. No real charges.
          </p>
        )}
      </header>
      {returned === "success" && (
        <p role="status" className="text-sm text-emerald-300">
          Payment received. Your add-on appears here as soon as Stripe confirms it.
        </p>
      )}
      {returned === "cancelled" && (
        <p role="status" className="text-sm text-primary/60">Checkout cancelled. Nothing was charged.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <ul className="text-sm text-primary/80 space-y-1">
        {FREE_FEATURES.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      {balances && (
        <p data-testid="balances" className="text-xs text-primary/60 font-mono">
          {balances.photo_credits} photo credits · {balances.voice_minutes} voice minutes ·{" "}
          {balances.deep_mode_active_until
            ? `deep mode until ${new Date(balances.deep_mode_active_until).toLocaleDateString()}`
            : "deep mode off"}
        </p>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        {offers.map((offer) => {
          const isJoined = joined.includes(offer.id);
          return (
            <div key={offer.id} className="border border-primary/20 bg-black/30 p-4 space-y-3">
              <h2 className="font-mono text-sm uppercase tracking-widest text-primary">{offer.name}</h2>
              <p className="text-xs text-primary/60">{offer.blurb}</p>
              {offer.units != null && (
                <p className="text-xs text-primary/50">
                  {offer.units} {offer.unitLabel}
                </p>
              )}
              {offer.purchasable ? (
                <button
                  type="button"
                  data-testid={`buy-${offer.id}`}
                  disabled={busy != null}
                  onClick={() => buy(offer)}
                  className="w-full min-h-[44px] border border-primary/40 bg-primary/10 text-primary font-mono text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {busy === offer.id ? "Opening checkout…" : "Buy"}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid={`waitlist-${offer.id}`}
                  disabled={isJoined || status == null}
                  onClick={() => {
                    track("subscription_upgrade_started", { tier: offer.id, purchase_type: "waitlist", from_tier: fromTier });
                    setJoined(joinWaitlist(offer.id));
                  }}
                  className="w-full min-h-[44px] border border-primary/30 text-primary/80 font-mono text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {isJoined ? "On the waitlist" : "Coming soon · join waitlist"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
