import { Check, X } from "lucide-react";
import { useState } from "react";

export default function SubscriptionCard({ plan, price, period, features, cta, onSelect, isCurrentPlan, loading }) {
  return (
    <div className={`relative border rounded overflow-hidden transition-all ${
      isCurrentPlan
        ? "border-primary/60 bg-primary/10 shadow-lg shadow-primary/20"
        : "border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5"
    }`}>
      {/* Badge */}
      {isCurrentPlan && (
        <div className="absolute top-0 right-0 bg-primary text-background px-3 py-1 font-mono text-[8px] tracking-widest uppercase">
          Current Plan
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Plan Name */}
        <div>
          <h3 className="font-mono text-lg text-primary tracking-wider uppercase mb-1">
            {plan}
          </h3>
          <p className="text-[9px] text-primary/40 tracking-widest">
            {price === "Free" ? "Starter" : "Premium Access"}
          </p>
        </div>

        {/* Price */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-mono text-primary font-bold">
              {price}
            </span>
            {price !== "Free" && (
              <span className="text-[9px] text-primary/40 tracking-widest uppercase">
                / {period}
              </span>
            )}
          </div>
          {price === "Free" && (
            <p className="text-[9px] text-primary/50 italic">Forever free</p>
          )}
        </div>

        {/* Features */}
        <div className="space-y-2 min-h-[180px]">
          {features.map((feature, idx) => (
            <div key={idx} className="flex items-start gap-2.5">
              {feature.included ? (
                <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              ) : (
                <X className="w-4 h-4 text-primary/20 flex-shrink-0 mt-0.5" />
              )}
              <span className={`text-[9px] font-mono leading-relaxed ${
                feature.included ? "text-primary/80" : "text-primary/20 line-through"
              }`}>
                {feature.name}
              </span>
            </div>
          ))}
        </div>

        {/* CTA Button */}
        <button
          onClick={onSelect}
          disabled={isCurrentPlan || loading}
          className={`w-full py-2.5 border font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            isCurrentPlan
              ? "border-primary/40 text-primary/40 bg-transparent"
              : price === "Free"
              ? "border-primary/20 text-primary/60 hover:text-primary/80 hover:border-primary/40"
              : "border-primary/50 text-primary bg-primary/10 hover:bg-primary/20"
          }`}
        >
          {isCurrentPlan ? "✓ Active" : cta}
          {loading && price !== "Free" && " ..."}
        </button>
      </div>
    </div>
  );
}