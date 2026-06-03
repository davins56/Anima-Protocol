// @ts-check
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import SubscriptionCard from "./SubscriptionCard";

const PLANS = [
  {
    id: "free",
    name: "Basic",
    price: "Free",
    period: "month",
    cta: "Current Plan",
    features: [
      { name: "Chat with characters", included: true },
      { name: "Solo & Group sessions", included: true },
      { name: "Character creation", included: false },
      { name: "Relationship graphs", included: false },
      { name: "World building tools", included: false },
      { name: "Memory systems", included: false },
      { name: "Quest tracking", included: false },
      { name: "Voice synthesis", included: false },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: "$19.99",
    period: "month",
    cta: "Subscribe Now",
    features: [
      { name: "Chat with characters", included: true },
      { name: "Solo & Group sessions", included: true },
      { name: "Character creation", included: true },
      { name: "Relationship graphs", included: true },
      { name: "World building tools", included: true },
      { name: "Memory systems", included: true },
      { name: "Quest tracking", included: true },
      { name: "Voice synthesis", included: true },
    ],
  },
];

export default function SubscriptionPlans() {
  const [user, setUser] = useState(/** @type {any} */ (null));
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSubscribe = async () => {
    if (!user) {
      /** @type {any} */ (base44.auth).redirectToLogin(window.location.href);
      return;
    }

    setCheckoutLoading(true);
    try {
      const response = await base44.functions.invoke("createCheckoutSession", {
        price_id: "price_1TUWuWEQeUkUPyATblCcxCtn", // $19.99/month premium subscription
        user_email: user.email,
        success_url: `${window.location.origin}/`,
        cancel_url: window.location.href,
      });

      if (response?.data?.checkout_url) {
        window.location.href = response.data.checkout_url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const currentPlan = user?.subscription_tier || "free";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-5xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="text-center space-y-3 mb-12">
        <h1 className="font-mono text-3xl text-primary glow-text tracking-[0.15em] uppercase">
          Choose Your Plan
        </h1>
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Unlock full access to Anima Protocol features
        </p>
      </div>

      {/* Plans Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {PLANS.map((plan) => (
          <SubscriptionCard
            key={plan.id}
            plan={plan.name}
            price={plan.price}
            period={plan.period}
            features={plan.features}
            cta={plan.cta}
            isCurrentPlan={currentPlan === plan.id}
            loading={checkoutLoading}
            onSelect={() => {
              if (plan.id === "premium") {
                handleSubscribe();
              }
            }}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="text-center space-y-4 p-6 border border-primary/10 bg-black/30 rounded">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Payment Processing
        </p>
        <p className="font-mono text-[10px] text-primary/60 max-w-2xl mx-auto leading-relaxed">
          Secure payments powered by Stripe. Cancel anytime with no penalties.
          Your subscription renews automatically on the same date each month.
        </p>
      </div>


    </motion.div>
  );
}