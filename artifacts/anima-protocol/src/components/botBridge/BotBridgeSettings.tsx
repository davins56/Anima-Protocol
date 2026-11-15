/**
 * Settings > Your bots. Renders nothing unless the server reports the bridge
 * enabled (`ANIMA_BOT_BRIDGE` on and its tables present). Any error while
 * loading the config counts as disabled.
 */
import { useEffect, useState } from "react";
import BotAwarenessPanel from "@/components/botBridge/BotAwarenessPanel";
import BotPermissionSettings from "@/components/botBridge/BotPermissionSettings";
import { useBotMessagePush } from "@/hooks/useBotMessagePush";
import {
  DISABLED_BRIDGE_CONFIG,
  loadBotPermissions,
  loadBotStatuses,
  loadBridgeConfig,
  type BotPermissions,
  type BotStatusCard,
  type BridgeConfig,
} from "@/lib/botBridge";

const PUSH_COPY: Record<string, string> = {
  unsupported: "This browser can't show notifications.",
  unavailable: "Bot message notifications aren't available yet.",
  default: "Get a notification when one of your bots leaves a message for a companion.",
  granted: "Notifications are on for this device.",
  denied: "Notifications are blocked in your browser settings.",
  error: "Could not turn on notifications.",
};

export default function BotBridgeSettings({ nowMs }: { nowMs?: number }) {
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [bots, setBots] = useState<BotStatusCard[] | null>(null);
  const [botsError, setBotsError] = useState("");
  const [permissions, setPermissions] = useState<BotPermissions | null>(null);
  const push = useBotMessagePush({ available: Boolean(config?.enabled && config.capabilities.inboundMessages) });

  useEffect(() => {
    let live = true;
    void loadBridgeConfig()
      .catch(() => DISABLED_BRIDGE_CONFIG)
      .then(async (cfg) => {
        if (!live) return;
        setConfig(cfg);
        if (!cfg.enabled) return;
        const [statusRes, permRes] = await Promise.all([loadBotStatuses(), loadBotPermissions()]);
        if (!live) return;
        if ("bots" in statusRes) setBots(statusRes.bots);
        else setBotsError(statusRes.message);
        if ("permissions" in permRes) setPermissions(permRes.permissions);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!config?.enabled) return null;

  return (
    <section className="space-y-4" data-testid="bot-bridge-settings" aria-label="Your bots">
      <h3 className="text-[9px] font-mono text-primary/40 tracking-[0.3em] uppercase">Your bots</h3>
      <div className="border border-primary/15 bg-card p-5 space-y-5">
        <BotAwarenessPanel bots={bots} error={botsError} nowMs={nowMs} />
        {permissions && (
          <BotPermissionSettings
            permissions={permissions}
            standingPermissionAvailable={config.capabilities.standingPermission}
          />
        )}
        <div className="space-y-1.5 border-t border-primary/10 pt-4">
          <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">Bot message alerts</p>
          <p className="text-[9px] font-mono text-primary/35">{PUSH_COPY[push.state]}</p>
          {push.error && <p className="text-[9px] font-mono text-destructive/80">{push.error}</p>}
          {push.state !== "granted" && push.state !== "unsupported" && (
            <button
              type="button"
              disabled={push.busy || push.state === "unavailable" || push.state === "denied"}
              onClick={() => void push.enable()}
              className="min-h-[44px] px-3 border border-primary/30 text-primary/80 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
            >
              {push.busy ? "Turning on…" : "Notify me"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
