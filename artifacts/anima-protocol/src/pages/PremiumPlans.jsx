import ComingSoonWaitlist from "@/components/subscription/ComingSoonWaitlist";

/** Payments are not live: an honest waitlist instead of a broken checkout. */
export default function PremiumPlans() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <ComingSoonWaitlist />
    </div>
  );
}
