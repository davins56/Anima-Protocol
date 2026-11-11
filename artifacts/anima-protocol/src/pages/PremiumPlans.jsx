import AddOnPlans from "@/components/subscription/AddOnPlans";

/** Paid add-ons (Stripe Checkout, test mode); text chat stays free. */
export default function PremiumPlans() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <AddOnPlans />
    </div>
  );
}
