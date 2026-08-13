import { useEffect, useState } from "react";
import { Bell, BellOff, Loader } from "lucide-react";
import {
  disableProactivePush,
  enableProactivePush,
  getProactiveMessagePreferences,
  supportsPushNotifications,
  updateProactiveMessagePreferences,
} from "@/lib/pushNotifications";

const FREQUENCIES = [
  { value: 24, label: "About once a day" },
  { value: 72, label: "About every 3 days" },
  { value: 168, label: "About once a week" },
];

function errorMessage(error) {
  return error instanceof Error ? error.message : "Could not update notifications.";
}

export default function ProactiveMessageSettings() {
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getProactiveMessagePreferences()
      .then((value) => {
        if (!cancelled) setPreferences(value);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const supported = supportsPushNotifications();
  const enabled = Boolean(preferences?.enabled);
  const frequencyHours = Number(preferences?.frequency_hours || 24);

  const toggle = async () => {
    if (busy || !preferences) return;
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        const saved = await updateProactiveMessagePreferences({
          enabled: false,
          frequencyHours,
        });
        setPreferences((current) => ({ ...current, ...saved, subscribed: false }));
        await disableProactivePush();
      } else {
        await enableProactivePush();
        const saved = await updateProactiveMessagePreferences({
          enabled: true,
          frequencyHours,
        });
        setPreferences((current) => ({ ...current, ...saved, subscribed: true }));
      }
    } catch (err) {
      setError(errorMessage(err));
      getProactiveMessagePreferences()
        .then(setPreferences)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const changeFrequency = async (event) => {
    const nextFrequency = Number(event.target.value);
    const previous = frequencyHours;
    setPreferences((current) => ({
      ...current,
      frequency_hours: nextFrequency,
    }));
    setError("");
    try {
      const saved = await updateProactiveMessagePreferences({
        enabled,
        frequencyHours: nextFrequency,
      });
      setPreferences((current) => ({ ...current, ...saved }));
    } catch (err) {
      setPreferences((current) => ({
        ...current,
        frequency_hours: previous,
      }));
      setError(errorMessage(err));
    }
  };

  return (
    <div className="border border-primary/15 bg-black/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="mt-0.5 text-primary/60">
            {enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </div>
          <div>
            <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">
              Character Messages
            </p>
            <p className="text-[9px] font-mono text-primary/35 mt-1 max-w-md leading-relaxed">
              Let characters from one-on-one chats send an occasional in-character
              check-in when you are away. They will never stack messages while
              waiting for your reply.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Allow character messages outside the app"
          onClick={toggle}
          disabled={
            loading ||
            busy ||
            !supported ||
            !preferences?.configured
          }
          className={`relative w-10 h-5 border transition-all flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${
            enabled
              ? "bg-primary/20 border-primary/50"
              : "bg-black/60 border-primary/15"
          }`}
        >
          {busy ? (
            <Loader className="absolute inset-0 m-auto w-3 h-3 animate-spin text-primary" />
          ) : (
            <span
              className={`absolute top-0.5 w-4 h-4 transition-all ${
                enabled ? "left-5 bg-primary" : "left-0.5 bg-primary/20"
              }`}
            />
          )}
        </button>
      </div>

      <div className="pl-7">
        <label
          htmlFor="proactive-message-frequency"
          className="block text-[9px] font-mono text-primary/40 tracking-[0.2em] uppercase mb-2"
        >
          Maximum frequency
        </label>
        <select
          id="proactive-message-frequency"
          value={frequencyHours}
          onChange={changeFrequency}
          disabled={loading || busy}
          className="w-full min-h-[42px] bg-black/60 border border-primary/20 px-3 text-primary/70 font-mono text-xs disabled:opacity-40"
        >
          {FREQUENCIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {!loading && !supported && (
        <p className="pl-7 text-[9px] font-mono text-amber-400/80">
          This browser does not support Web Push notifications.
        </p>
      )}
      {!loading && supported && preferences && !preferences.configured && (
        <p className="pl-7 text-[9px] font-mono text-amber-400/80">
          Character notifications are not configured on this deployment yet.
        </p>
      )}
      {enabled && !error && (
        <p className="pl-7 text-[9px] font-mono text-emerald-400/70">
          Active on this device. Your next check-in is scheduled automatically.
        </p>
      )}
      {error && (
        <p role="alert" className="pl-7 text-[9px] font-mono text-rose-400/80">
          {error}
        </p>
      )}
    </div>
  );
}
