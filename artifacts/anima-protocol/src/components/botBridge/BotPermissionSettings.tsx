/**
 * Per-companion × per-bot outbound permission. Every pair is "Ask every time"
 * until the user chooses otherwise. "Allow without asking" (a narrow standing
 * permission) stays disabled until the backend for it exists.
 */
import { permissionModeFor, type BotPermissions, type PermissionMode } from "@/lib/botBridge";

export default function BotPermissionSettings({
  permissions,
  standingPermissionAvailable = false,
  onChange,
}: {
  permissions: BotPermissions;
  standingPermissionAvailable?: boolean;
  onChange?: (companionId: string, botId: string, mode: PermissionMode) => void;
}) {
  if (!permissions.companions.length || !permissions.bots.length) {
    return <p className="text-[9px] font-mono text-primary/45">No companions or bots to set up yet.</p>;
  }
  return (
    <div className="space-y-3" data-testid="bot-permissions">
      <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">Messages to your bots</p>
      <p className="text-[9px] font-mono text-primary/35 leading-relaxed max-w-md">
        A companion can draft a message to one of your bots. By default you confirm every message before it is sent.
        {!standingPermissionAvailable && " Allowing messages without asking isn't available yet."}
      </p>
      {permissions.companions.map((companion) => (
        <fieldset key={companion.id} className="space-y-1.5 border border-primary/10 p-2">
          <legend className="font-mono text-[10px] text-primary/70 px-1">{companion.name}</legend>
          {permissions.bots.map((bot) => {
            const mode = permissionModeFor(permissions.rules, companion.id, bot.bot_id);
            const id = `bot-perm-${companion.id}-${bot.bot_id}`;
            return (
              <div key={bot.bot_id} className="flex items-center justify-between gap-3">
                <label htmlFor={id} className="font-mono text-[10px] text-primary/60">
                  {bot.display_name}
                </label>
                <select
                  id={id}
                  value={mode}
                  onChange={(e) => onChange?.(companion.id, bot.bot_id, e.target.value as PermissionMode)}
                  disabled={!onChange}
                  className="min-h-[44px] bg-card border border-primary/20 font-mono text-[10px] text-primary/80 px-2"
                >
                  <option value="ask">Ask every time</option>
                  <option value="allow" disabled={!standingPermissionAvailable}>
                    Allow without asking
                  </option>
                </select>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
