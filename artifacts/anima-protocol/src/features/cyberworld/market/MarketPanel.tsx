import { useMemo, useState } from "react";
import { LOOT_BY_ID, RARITY } from "../explore/loot";
import type { Progress } from "../explore/progress";
import { cosmeticsOf, buy, dailyOffers, giftables, price, SHOP, swap, toggleEquip, tradeableOf, tradeUp, walletBits, canAfford, type TradeResult } from "./economy";

type Tab = "shop" | "exchange" | "gift";

/** Data Bazaar vendor panel: shop, exchange and gifting. Compact, HUD-styled, mobile-friendly; Esc closes (handled by the page). */
export function MarketPanel({
  open,
  progress,
  dayKey,
  giftTarget,
  onChange,
  onGift,
  onClose,
}: {
  open: boolean;
  progress: Progress;
  dayKey: string;
  giftTarget: { name: string; color?: string } | null;
  onChange: (progress: Progress, message: string) => void;
  onGift: (itemId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("shop");
  const [note, setNote] = useState<string | null>(null);
  const offers = useMemo(() => dailyOffers(dayKey), [dayKey]);
  if (!open) return null;
  const inv = progress.inventory;
  const bits = walletBits(inv);
  const cos = cosmeticsOf(progress);
  const apply = (r: TradeResult) => {
    if ("progress" in r) {
      onChange(r.progress, r.message);
      setNote(r.message);
    } else setNote(r.reason);
  };
  const name = (id: string) => LOOT_BY_ID[id]?.name ?? id;
  const color = (id: string) => (LOOT_BY_ID[id] ? RARITY[LOOT_BY_ID[id].rarity].color : "#e2e8f0");
  const btn = "border px-2 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40";
  return (
    <div className="absolute inset-x-2 bottom-[108px] z-30 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-20 sm:w-[26rem] sm:-translate-x-1/2" role="dialog" aria-label="Data Bazaar vendor">
      <div data-net-hud-panel className="flex max-h-[55vh] flex-col border border-orange-300/60 bg-black/90 font-mono text-orange-50 sm:max-h-[70vh]">
        <div className="flex items-center gap-1 border-b border-orange-300/30 p-2 text-[10px] uppercase tracking-widest">
          {(["shop", "exchange", "gift"] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setTab(t); setNote(null); }} className={`px-2 py-1 ${tab === t ? "bg-orange-400/15 text-orange-200" : "text-muted-foreground"}`}>
              {t}
            </button>
          ))}
          <span className="ml-auto text-orange-200" title="Fragments are worth bits: common 1, uncommon 3">
            {bits} bits
          </span>
          <button type="button" onClick={onClose} className="px-2 py-1 text-muted-foreground" aria-label="Close market">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-2 text-[11px]">
          {note && <p className="mb-1.5 text-orange-200">{note}</p>}
          {tab === "shop" && (
            <ul className="space-y-1.5">
              {SHOP.map((s) => {
                const owned = s.kind === "cosmetic" && cos.owned.includes(s.id);
                const equipped = !!s.slot && cos.equipped[s.slot] === s.id;
                return (
                  <li key={s.id} className="flex items-center gap-2 border p-1.5" style={{ borderColor: `${RARITY[s.rarity].color}66` }}>
                    {s.color && <span className="h-3 w-3 shrink-0" style={{ background: s.color }} />}
                    <span className="min-w-0 flex-1">
                      <span style={{ color: RARITY[s.rarity].color }}>{s.name}</span>
                      {(inv[s.id] ?? 0) > 0 && <span className="text-muted-foreground"> ×{inv[s.id]}</span>}
                      <span className="block text-[10px] text-muted-foreground">{s.desc}</span>
                    </span>
                    {owned ? (
                      <button type="button" className={`${btn} border-orange-300/50`} onClick={() => onChange(toggleEquip(progress, s.id), equipped ? `Unequipped ${s.name}` : `Equipped ${s.name}`)}>
                        {equipped ? "Unequip" : "Equip"}
                      </button>
                    ) : (
                      <button type="button" className={`${btn} border-orange-300/50`} disabled={!canAfford(inv, price(s))} onClick={() => apply(buy(progress, s.id))}>
                        {price(s)} bits
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {tab === "exchange" && (
            <>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Trade up · today&apos;s board</p>
              <ul className="mb-2 space-y-1.5">
                {offers.tradeUps.map((o) => {
                  const have = tradeableOf(inv, o.from).reduce((s, x) => s + x.count, 0);
                  return (
                    <li key={o.from} className="flex items-center gap-2 border border-orange-300/30 p-1.5">
                      <span className="flex-1">
                        {o.n} <span style={{ color: RARITY[o.from].color }}>{o.from}</span> → <span style={{ color: color(o.toId) }}>{name(o.toId)}</span>
                        <span className="text-muted-foreground"> (have {have})</span>
                      </span>
                      <button type="button" className={`${btn} border-orange-300/50`} disabled={have < o.n} onClick={() => apply(tradeUp(progress, o, dayKey))}>
                        Trade
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Biome swaps · today</p>
              <ul className="space-y-1.5">
                {offers.swaps.map((o) => (
                  <li key={o.giveId} className="flex items-center gap-2 border border-orange-300/30 p-1.5">
                    <span className="flex-1">
                      <span style={{ color: color(o.giveId) }}>{name(o.giveId)}</span> → <span style={{ color: color(o.getId) }}>{name(o.getId)}</span>
                      <span className="text-muted-foreground"> (have {inv[o.giveId] ?? 0})</span>
                    </span>
                    <button type="button" className={`${btn} border-orange-300/50`} disabled={(inv[o.giveId] ?? 0) < 1} onClick={() => apply(swap(progress, o, dayKey))}>
                      Swap
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tab === "gift" &&
            (giftTarget ? (
              (() => {
                const list = giftables(inv);
                return list.length ? (
                  <>
                    <p className="mb-1.5 text-muted-foreground">
                      Give something to <span style={{ color: giftTarget.color || "#F472B6" }} data-hud-character>{giftTarget.name}</span>:
                    </p>
                    <ul className="grid grid-cols-2 gap-1.5">
                      {list.map((g) => (
                        <li key={g.id}>
                          <button type="button" onClick={() => onGift(g.id)} className="w-full border border-pink-300/40 p-1.5 text-left">
                            {g.special ? "♡ " : ""}
                            {g.name}
                            <span className="float-right text-muted-foreground">×{g.count}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted-foreground">Nothing to give yet. Buy a gift in the shop, or hack nodes for items.</p>
                );
              })()
            ) : (
              <p className="text-muted-foreground">Bring a companion (Accompany, C) or stand near one to give a gift.</p>
            ))}
        </div>
      </div>
    </div>
  );
}
