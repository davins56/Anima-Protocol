import {
  THERAPY_CRISIS_RESOURCES,
  THERAPY_DISCLAIMER,
  localizedTherapyResource,
} from "@/lib/therapyManuals";
import { Shield } from "lucide-react";

/**
 * Persistent care banner for therapy-mode chat sessions.
 * @param {{ crisis?: boolean, characterName?: string, country?: string }} props
 */
export default function TherapySessionBanner({ crisis = false, characterName, country }) {
  const localResource = localizedTherapyResource(country);
  return (
    <div
      className={`px-3 sm:px-4 py-2 border-b font-mono ${
        crisis
          ? "border-red-400/40 bg-red-950/40 text-red-100"
          : "border-violet-400/20 bg-violet-950/30 text-violet-100/80"
      }`}
    >
      <div className="flex items-start gap-2">
        <Shield className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${crisis ? "text-red-300" : "text-violet-300"}`} />
        <div className="min-w-0 space-y-1">
          <p className="text-[9px] sm:text-[10px] tracking-[0.2em] uppercase">
            Therapy mode{characterName ? ` · ${characterName}` : ""} · compiled care manuals
          </p>
          {crisis ? (
            <p className="text-[11px] leading-relaxed text-red-50/90">
              If you are in danger, contact local emergency services now.{" "}
              {localResource
                ? `${localResource.name}: ${localResource.contact}. `
                : "Use a local crisis line. "}
              Worldwide:{" "}
              <a
                href={THERAPY_CRISIS_RESOURCES.intl.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {THERAPY_CRISIS_RESOURCES.intl.url.replace("https://", "")}
              </a>
            </p>
          ) : (
            <p className="text-[10px] sm:text-[11px] leading-relaxed text-violet-100/60">
              {THERAPY_DISCLAIMER}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
