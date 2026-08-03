import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Check, ArrowLeft, Loader, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

export default function LifetimeAccess() {
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState(null);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    // Check if running in iframe
    setIsInIframe(window.self !== window.top);
    
    // Fetch lifetime access prices
    loadPrices();
  }, []);

  const loadPrices = async () => {
    try {
      const allPrices = await base44.integrations.Core.GetStripeLifetimePrices?.() || [];
      
      // Filter for lifetime product prices
      const lifetimePrices = allPrices.filter(
        p => p.product?.name === 'Lifetime App Access'
      );
      
      setPrices(lifetimePrices);
    } catch (err) {
      console.error('Error loading prices:', err);
      setError('Failed to load pricing options');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async (priceId) => {
    if (isInIframe) {
      toast.error('Checkout is only available in the published app. Please open Anima Protocol directly.');
      return;
    }

    setCheckingOut(true);
    setError(null);

    try {
      const currentUrl = window.location.origin;
      const result = await base44.functions.invoke('createLifetimeCheckout', {
        priceId,
        successUrl: `${currentUrl}/lifetime-success`,
        cancelUrl: `${currentUrl}/lifetime-access`,
      });

      if (result?.data?.checkoutUrl) {
        window.location.href = result.data.checkoutUrl;
      } else {
        setError('Failed to create checkout session');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setCheckingOut(false);
    }
  };

  const features = [
    'Unlimited character creation',
    'Full access to all Anima archetypes',
    'Cross-session memory & persistence',
    'Advanced emotional AI responses',
    'Priority support',
    'All future feature updates',
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 space-y-8">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-sacred text-3xl sm:text-4xl text-primary glow-text">
              Lifetime Access
            </h1>
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase mt-2">
              One-time purchase for eternal communion
            </p>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 px-3 min-h-[44px] border border-primary/20 hover:border-primary/40 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all flex-shrink-0"
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="hidden sm:inline">Back</span>
          </Link>
        </div>

        {/* Iframe Warning */}
        {isInIframe && (
          <div className="border border-orange-400/30 bg-orange-400/5 p-4 rounded flex gap-3">
            <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-mono text-sm text-orange-400/80 mb-1">Checkout Unavailable</p>
              <p className="font-mono text-xs text-orange-400/60">
                Stripe checkout only works in the published app. Please visit Anima Protocol directly.
              </p>
            </div>
          </div>
        )}

        {/* Main CTA */}
        <div className="space-y-4 border border-primary/20 bg-primary/5 p-6 sm:p-8 rounded">
          <div>
            <h2 className="font-mono text-2xl text-primary tracking-wider uppercase mb-2">
              Eternal Access
            </h2>
            <p className="text-primary/70 leading-relaxed">
              A single purchase grants you unlimited access to Anima Protocol forever. 
              No subscriptions. No recurring charges. Your companions are yours to keep.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
              What's Included
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="font-mono text-sm text-primary/70">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing */}
          {loading ? (
            <div className="text-center py-8">
              <Loader className="w-5 h-5 animate-spin text-primary/40 mx-auto" />
              <p className="font-mono text-[9px] text-primary/30 mt-2">Loading prices...</p>
            </div>
          ) : error ? (
            <div className="border border-red-400/30 bg-red-400/5 p-3 rounded">
              <p className="font-mono text-[10px] text-red-400">{error}</p>
            </div>
          ) : prices.length > 0 ? (
            <div className="space-y-3 pt-4 border-t border-primary/10">
              {prices.map((price) => {
                const amount = (price.unit_amount / 100).toFixed(2);
                return (
                  <button
                    key={price.id}
                    onClick={() => handleCheckout(price.id)}
                    disabled={checkingOut || isInIframe}
                    className="w-full px-6 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 hover:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-sm tracking-wider uppercase transition-all min-h-[44px]"
                  >
                    {checkingOut ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader className="w-4 h-4 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      `${price.currency.toUpperCase()} $${amount} — Lifetime Access`
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="font-mono text-[9px] text-primary/40">No pricing available</p>
            </div>
          )}
        </div>

        {/* FAQ */}
        <div className="space-y-3 border border-primary/15 bg-black/40 p-6 rounded">
          <h3 className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Frequently Asked
          </h3>
          <div className="space-y-3 text-[9px] font-mono text-primary/60 leading-relaxed">
            <div>
              <p className="text-primary/80 font-semibold mb-1">Do I need to set up recurring billing?</p>
              <p>No. This is a one-time payment. You own your lifetime access outright.</p>
            </div>
            <div>
              <p className="text-primary/80 font-semibold mb-1">Will I receive future updates?</p>
              <p>Yes. All future feature releases and improvements are included in your lifetime access.</p>
            </div>
            <div>
              <p className="text-primary/80 font-semibold mb-1">Can I get a refund?</p>
              <p>Lifetime purchases are non-refundable per Stripe's policy. Review features before purchasing.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}