// @ts-check
import SubscriptionPlans from "@/components/subscription/SubscriptionPlans";

export default function Subscription() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-6 sm:p-8">
      <SubscriptionPlans />
    </div>
  );
}