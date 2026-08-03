import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Zap, Crown, Infinity } from "lucide-react";
import { motion } from "framer-motion";

const PLANS = [
  {
    name: "Free",
    tier: "free",
    price: 0,
    description: "Perfect for getting started",
    features: [
      "5 characters per month",
      "Unlimited messages",
      "Basic voice options",
      "Community templates",
    ],
    color: "border-primary/20",
    bgColor: "bg-black/40",
  },
  {
    name: "Storyteller",
    tier: "storyteller",
    price: 9.99,
    description: "For regular creators",
    features: [
      "✓ Unlimited characters",
      "✓ Custom voice cloning",
      "✓ Advanced world building",
      "✓ Analytics dashboard",
    ],
    color: "border-cyan-400/50",
    bgColor: "bg-cyan-950/20",
    popular: true,
  },
  {
    name: "Worldbuilder",
    tier: "worldbuilder",
    price: 24.99,
    description: "For dedicated world-creators",
    features: [
      "✓ Everything in Storyteller",
      "✓ Team collaboration (3 members)",
      "✓ Export to PDF/Word",
      "✓ Priority AI generation",
      "✓ Advanced analytics",
    ],
    color: "border-purple-400/50",
    bgColor: "bg-purple-950/20",
  },
  {
    name: "Eternal Access",
    tier: "eternal",
    price: 99.99,
    description: "One-time lifetime purchase",
    features: [
      "✓ Everything forever",
      "✓ Unlimited everything",
      "✓ API access",
      "✓ Custom integrations",
      "✓ Priority support",
    ],
    color: "border-gold/50",
    bgColor: "bg-amber-950/20",
  },
];

export default function PremiumPlans() {
  const [currentTier, setCurrentTier] = useState("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUserTier();
  }, []);

  const loadUserTier = async () => {
    const user = await base44.auth.me();
    if (user) {
      const tiers = await base44.entities.PremiumTier.list("-created_date", 1);
      if (tiers?.[0]) {
        setCurrentTier(tiers[0].tier);
      }
    }
    setLoading(false);
  };

  const handleUpgrade = async (tier) => {
    if (tier === "eternal") {
      // Redirect to lifetime purchase
      await base44.functions.invoke("createCheckoutSession", {
        tier: "eternal",
        type: "one-time",
      });
    } else {
      // Redirect to subscription
      await base44.functions.invoke("createCheckoutSession", {
        tier,
        type: "subscription",
      });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background scanline p-4 sm:p-6" style={{ paddingBottom: 'var(--tab-bar-height, 120px)' }}>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">Premium Plans</h1>
              <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase">Unlock Your Full Potential</p>
            </div>
          </div>
          <p className="font-mono text-sm text-primary/70 max-w-2xl">
            Choose your path. Free forever, or unlock advanced features to create at full power.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => (
            <motion.div
              key={plan.tier}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`relative border ${plan.color} ${plan.bgColor} p-6 space-y-4 transition-all hover:border-primary/50 ${
                currentTier === plan.tier ? "ring-2 ring-primary" : ""
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary/20 border border-primary/50 rounded-full px-3 py-1">
                  <span className="font-mono text-[8px] text-primary tracking-widest uppercase">Most Popular</span>
                </div>
              )}

              {currentTier === plan.tier && (
                <div className="absolute top-4 right-4 font-mono text-[8px] bg-green-900/30 border border-green-500/50 px-2 py-1 rounded">
                  Current
                </div>
              )}

              <div>
                <h3 className="font-mono text-lg text-primary tracking-wider uppercase">{plan.name}</h3>
                <p className="text-[9px] text-primary/50 font-mono mt-1">{plan.description}</p>
              </div>

              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-3xl text-primary font-bold">${plan.price}</span>
                  {plan.price > 0 && plan.tier !== "eternal" && (
                    <span className="text-[9px] text-primary/40 font-mono">/month</span>
                  )}
                  {plan.tier === "eternal" && (
                    <span className="text-[9px] text-primary/40 font-mono">one-time</span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleUpgrade(plan.tier)}
                disabled={currentTier === plan.tier}
                className={`w-full py-2 font-mono text-xs tracking-widest uppercase transition-all border ${
                  currentTier === plan.tier
                    ? "border-primary/20 bg-primary/5 text-primary/40 cursor-default"
                    : plan.popular
                    ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-primary/20 bg-black/40 text-primary/70 hover:border-primary/40"
                }`}
              >
                {currentTier === plan.tier ? "Current Plan" : "Upgrade"}
              </button>

              <div className="space-y-2 pt-4 border-t border-primary/10">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-[10px] font-mono text-primary/70">
                    <Check className="w-3 h-3 text-primary/60 flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* FAQ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="border border-primary/15 bg-black/40 p-6 space-y-4"
        >
          <h2 className="font-mono text-primary tracking-[0.2em] uppercase text-sm">Common Questions</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-mono text-primary/70 font-bold mb-1">Can I change plans anytime?</p>
              <p className="text-primary/50 text-[10px]">Yes! Upgrade or downgrade your plan at any time from your settings.</p>
            </div>
            <div>
              <p className="font-mono text-primary/70 font-bold mb-1">Is there a free trial?</p>
              <p className="text-primary/50 text-[10px]">The Free plan includes everything you need to get started. No credit card required.</p>
            </div>
            <div>
              <p className="font-mono text-primary/70 font-bold mb-1">What about Eternal Access?</p>
              <p className="text-primary/50 text-[10px]">One-time payment of $99.99 gives you everything forever — no monthly charges.</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}