// @ts-check
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import AddOnPlans from "./AddOnPlans";

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

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Stripe Checkout add-ons (server-priced, webhook-fulfilled).
  return <AddOnPlans fromTier={user?.subscription_tier || "free"} />;
}

/** Feature matrix kept for the plans copy once payments open. */
export { PLANS };
