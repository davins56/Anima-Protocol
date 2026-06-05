// @ts-check
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Check, Loader, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PRICE_ID = "price_1TVD7JEQeUkUPyATLV81vJ25";

export default function PremiumSubscription() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const navigate = useNavigate();

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await base44.functions.invoke("createCheckoutSession", {
        price_id: PRICE_ID,
        success_url: `${window.location.origin}/subscription?success=true`,
        cancel_url: `${window.location.origin}/subscription?cancelled=true`,
      });

      if (response?.data?.checkout_url) {
        window.location.href = response.data.checkout_url;
      } else {
        setError("Failed to create checkout session");
      }
    } catch (/** @type {any} */ err) {
      setError(err?.message || "Subscription failed");
      console.error("Subscription error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-sacred text-primary glow-text tracking-[0.15em] uppercase">
            Premium Habit Tracking
          </h1>
          <p className="text-primary/60 font-mono text-sm mt-2">
            Unlock advanced features and insights
          </p>
        </div>

        {/* Pricing Card */}
        <div className="border border-primary/20 bg-primary/5 rounded-lg p-8 space-y-6">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-4xl font-bold text-primary">$9.99</span>
            <span className="text-primary/60 font-mono text-sm">/month</span>
          </div>

          {/* Features List */}
          <ul className="space-y-3">
            {[
              "Unlimited habit tracking",
              "Advanced analytics & insights",
              "Personalized recommendations",
              "Data export & backup",
              "Priority support",
            ].map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
                <span className="font-mono text-sm text-primary/80">{feature}</span>
              </li>
            ))}
          </ul>

          {/* Error Display */}
          {error && (
            <div className="flex items-center gap-3 p-3 border border-red-400/30 bg-red-400/5 rounded text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Subscribe Button */}
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full px-6 py-3 bg-primary text-primary-foreground font-mono text-sm tracking-widest uppercase disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Start Free Trial"
            )}
          </button>

          <p className="text-center text-[9px] font-mono text-primary/40">
            Cancel anytime. First month free, then $9.99/month.
          </p>
        </div>

        {/* Back Button */}
        <button
          onClick={() => navigate("/")}
          className="w-full px-4 py-2 border border-primary/20 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-colors"
        >
          Back to App
        </button>
      </div>
    </div>
  );
}