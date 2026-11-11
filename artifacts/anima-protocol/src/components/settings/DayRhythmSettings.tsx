import { useEffect, useId, useMemo, useState } from "react";
import { Clock, Loader, SunMoon } from "lucide-react";
import {
  DEFAULT_RHYTHM_DRAFT,
  SERVER_QUIET_HOURS_LABEL,
  deviceTimezone,
  formatHourLabel,
  getRhythmSettings,
  isDayRhythmOptedIn,
  listTimezones,
  loadSensesStatus,
  optInDayRhythm,
  optOutAndForgetRhythm,
  type RhythmSettingsDraft,
  type SensesStatus,
} from "@/lib/dayRhythm";
import {
  sensesTimezoneOverride,
  setSensesTimezoneOverride,
} from "@/lib/animaSenses";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function ToggleSwitch({
  id,
  label,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative w-10 h-5 border flex-shrink-0 disabled:opacity-40 motion-safe:transition-all ${
        checked ? "bg-primary/20 border-primary/50" : "bg-black/60 border-primary/15"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 motion-safe:transition-all ${
          checked ? "left-5 bg-primary" : "left-0.5 bg-primary/20"
        }`}
      />
    </button>
  );
}

export default function DayRhythmSettings() {
  const optInId = useId();
  const timezoneId = useId();
  const startHourId = useId();
  const endHourId = useId();
  const deviceTz = useMemo(() => deviceTimezone(), []);
  const timezones = useMemo(() => listTimezones(deviceTz), [deviceTz]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SensesStatus | null>(null);
  const [optedIn, setOptedIn] = useState(() => isDayRhythmOptedIn());
  const [timezone, setTimezone] = useState(
    () => sensesTimezoneOverride() || deviceTz || "UTC",
  );
  const [usingDeviceTz, setUsingDeviceTz] = useState(() => !sensesTimezoneOverride());
  const [settingsConnection, setSettingsConnection] = useState<"unknown" | "not_connected_yet">(
    "unknown",
  );
  const [draft, setDraft] = useState<RhythmSettingsDraft>(DEFAULT_RHYTHM_DRAFT);
  const [confirmForget, setConfirmForget] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [load, rhythm] = await Promise.all([loadSensesStatus(), getRhythmSettings()]);
      if (cancelled) return;
      if (load.ok) {
        setStatus(load.status);
      } else {
        setError("message" in load ? String(load.message) : "Could not load day rhythm status.");
      }
      if (!rhythm.connected) setSettingsConnection(rhythm.reason);
      if (load.ok && load.status.timezone && !sensesTimezoneOverride()) {
        // Show the stored snapshot timezone without treating it as a new override.
        setTimezone(load.status.timezone);
        setUsingDeviceTz(load.status.timezone === deviceTz);
      }
      setOptedIn(isDayRhythmOptedIn());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceTz]);

  const serverOff = status?.enabled === false;
  const timezoneApplies = Boolean(timezone);

  const applyTimezone = async (nextTz: string, useDevice: boolean) => {
    setTimezone(nextTz);
    setUsingDeviceTz(useDevice);
    setSensesTimezoneOverride(useDevice ? null : nextTz);
    if (!isDayRhythmOptedIn()) return;
    setBusy(true);
    setError("");
    const result = await optInDayRhythm({ timezone: useDevice ? null : nextTz });
    setBusy(false);
    if (result.ok) {
      setStatus(result.status);
      setOptedIn(true);
    } else if ("serverOff" in result && result.serverOff) {
      setStatus((current) => ({ enabled: false, present: current?.present ?? false }));
    } else if ("message" in result && result.message) {
      setError(result.message);
    }
  };

  const toggleOptIn = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setConfirmForget(false);
    if (optedIn) {
      const result = await optOutAndForgetRhythm();
      setBusy(false);
      if (result.ok) {
        setOptedIn(false);
        setStatus((current) => ({
          enabled: current?.enabled ?? false,
          present: false,
        }));
      } else {
        setError("message" in result ? result.message : "Could not forget your rhythm data. Please try again.");
      }
      return;
    }
    const result = await optInDayRhythm({
      timezone: usingDeviceTz ? null : timezone,
    });
    setBusy(false);
    if (result.ok) {
      setOptedIn(true);
      setStatus(result.status);
    } else if ("serverOff" in result && result.serverOff) {
      setOptedIn(true);
      setStatus((current) => ({ enabled: false, present: current?.present ?? false }));
    } else if ("message" in result && result.message) {
      setError(result.message);
    }
  };

  const forget = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await optOutAndForgetRhythm();
    setBusy(false);
    setConfirmForget(false);
    if (result.ok) {
      setOptedIn(false);
      setStatus((current) => ({
        enabled: current?.enabled ?? false,
        present: false,
      }));
    } else {
      setError("message" in result ? result.message : "Could not forget your rhythm data. Please try again.");
    }
  };

  const toggleDay = (day: number) => {
    setDraft((current) => {
      const has = current.quietDays.includes(day);
      const quietDays = has
        ? current.quietDays.filter((item) => item !== day)
        : [...current.quietDays, day].sort((a, b) => a - b);
      return { ...current, quietDays };
    });
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading day rhythm"
        className="border border-primary/15 bg-black/40 p-5 flex items-center gap-2 text-primary/40"
      >
        <Loader className="w-4 h-4 motion-safe:animate-spin" />
        <span className="font-mono text-[10px] tracking-widest uppercase">Loading day rhythm</span>
      </div>
    );
  }

  return (
    <div className="border border-primary/15 bg-black/40 p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3 min-w-0">
          <div className="mt-0.5 text-primary/60">
            <SunMoon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="font-mono text-xs text-primary/70 tracking-wider uppercase">
              Day rhythm
            </h3>
            <p className="text-[9px] font-mono text-primary/35 mt-1 max-w-md leading-relaxed">
              Let her notice your daily timing so she can wait during quiet hours
              or while you are busy, instead of starting a conversation at a bad
              moment. Nothing is shared until you turn this on.
            </p>
            <p className="text-[9px] font-mono text-primary/35 mt-2 max-w-md leading-relaxed">
              If you opt in, this device may share your timezone (quiet hours
              cannot apply without one), a few signals the browser already
              exposes such as whether you are online or on low battery, and —
              when a calendar connection exists — busy or free blocks only.
              Event titles never reach her prompts. The server keeps only the
              latest snapshot, drops it after six hours, and uses it to choose
              when she speaks, not what she says.
            </p>
          </div>
        </div>
        <ToggleSwitch
          id={optInId}
          label={optedIn ? "Turn off day rhythm" : "Turn on day rhythm"}
          checked={optedIn}
          disabled={busy}
          onToggle={toggleOptIn}
        />
      </div>

      <div aria-live="polite" className="space-y-1">
        {serverOff && (
          <p className="text-[9px] font-mono text-amber-400/80 leading-relaxed">
            Day rhythm is turned off on the server.
          </p>
        )}
        {error && (
          <p className="text-[9px] font-mono text-destructive/80 leading-relaxed">{error}</p>
        )}
        {optedIn && status?.present && !serverOff && (
          <p className="text-[9px] font-mono text-primary/45 leading-relaxed">
            Snapshot on the server
            {status.timezone ? ` in ${status.timezone}` : ""}.
            {typeof status.calendarBlocks === "number"
              ? ` ${status.calendarBlocks} busy/free block${status.calendarBlocks === 1 ? "" : "s"}.`
              : ""}
            {status.busyNow ? " You look busy right now." : ""}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor={timezoneId}
          className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase"
        >
          Timezone
        </label>
        <p className="text-[9px] font-mono text-primary/35 leading-relaxed">
          Defaults to this device{deviceTz ? ` (${deviceTz})` : ""}. Quiet hours
          need a timezone to apply. An override is sent with the snapshot when
          day rhythm is on.
        </p>
        <select
          id={timezoneId}
          value={timezone}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            void applyTimezone(next, next === deviceTz);
          }}
          className="w-full min-h-[44px] bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
              {tz === deviceTz ? " (this device)" : ""}
            </option>
          ))}
        </select>
        {!usingDeviceTz && deviceTz && (
          <button
            type="button"
            className="font-mono text-[10px] text-primary/60 tracking-widest uppercase underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary min-h-[44px]"
            onClick={() => void applyTimezone(deviceTz, true)}
          >
            Use device timezone
          </button>
        )}
        {!timezoneApplies && (
          <p className="text-[9px] font-mono text-amber-400/80">
            Quiet hours need a timezone to apply.
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-primary/10 pt-4">
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          Quiet hours
        </p>
        <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
          {SERVER_QUIET_HOURS_LABEL}
        </p>
        <p className="text-[9px] font-mono text-primary/35 leading-relaxed">
          Quiet hours also silence her self-started messages. They use your
          timezone from the snapshot; without a timezone they do not apply.
          This default is set on the server for everyone — there is no per-user
          route for it yet.
        </p>
        {settingsConnection === "not_connected_yet" && (
          <p role="status" className="text-[9px] font-mono text-primary/45 leading-relaxed">
            Per-user and per-companion quiet hours are not connected yet.
            Changes below stay in this screen only and are not saved.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={startHourId}
              className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2"
            >
              Start
            </label>
            <select
              id={startHourId}
              value={draft.quietStartHour}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  quietStartHour: Number(event.target.value),
                }))
              }
              className="w-full min-h-[44px] bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3"
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {formatHourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={endHourId}
              className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2"
            >
              End
            </label>
            <select
              id={endHourId}
              value={draft.quietEndHour}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  quietEndHour: Number(event.target.value),
                }))
              }
              className="w-full min-h-[44px] bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3"
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {formatHourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {draft.quietStartHour > draft.quietEndHour && (
          <p className="text-[9px] font-mono text-primary/35">
            This window crosses midnight.
          </p>
        )}
        <fieldset className="space-y-2">
          <legend className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
            Days of week
          </legend>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => {
              const checked = draft.quietDays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggleDay(day.value)}
                  className={`min-h-[44px] min-w-[44px] px-2 border font-mono text-[10px] tracking-widest uppercase motion-safe:transition-colors ${
                    checked
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "border-primary/15 text-primary/40"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <p className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-1">
            Per companion
          </p>
          <p className="text-[9px] font-mono text-primary/35 leading-relaxed">
            Quiet hours are global only. A per-companion override is not
            connected yet.
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t border-primary/10 pt-4">
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">
          Calendar awareness
        </p>
        <div className="flex items-start justify-between gap-4">
          <p className="text-[9px] font-mono text-primary/35 leading-relaxed max-w-md">
            Coming soon. This browser cannot read your calendar, and there is
            no calendar sign-in here. When a connection exists, she will only
            see busy or free blocks — not event titles.
          </p>
          <ToggleSwitch
            id="day-rhythm-calendar"
            label="Calendar awareness (coming soon)"
            checked={false}
            disabled
            onToggle={() => {}}
          />
        </div>
      </div>

      <div className="border-t border-primary/10 pt-4">
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">
          Forget my rhythm data
        </p>
        <p className="text-[9px] font-mono text-primary/35 mt-1 leading-relaxed">
          Deletes the snapshot stored on the server and stops this device from
          sending another until you opt in again.
        </p>
        {confirmForget ? (
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void forget()}
              className="min-h-[44px] px-4 border border-rose-500/40 bg-rose-950/30 text-rose-300 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
            >
              {busy ? "Forgetting…" : "Confirm forget"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmForget(false)}
              className="min-h-[44px] px-4 border border-primary/20 text-primary/70 font-mono text-[10px] tracking-widest uppercase"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmForget(true)}
            className="mt-3 min-h-[44px] px-4 border border-rose-500/40 text-rose-300 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
          >
            Forget my rhythm data
          </button>
        )}
      </div>
    </div>
  );
}
