import { useEffect } from "react";
import { X, Fingerprint, BookOpen, ScrollText, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const CATEGORY_COLORS = {
  companion: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
  warrior: "text-red-400 border-red-400/30 bg-red-400/5",
  mystic: "text-purple-400 border-purple-400/30 bg-purple-400/5",
  scientist: "text-green-400 border-green-400/30 bg-green-400/5",
  villain: "text-orange-400 border-orange-400/30 bg-orange-400/5",
  hero: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  other: "text-primary/50 border-primary/20 bg-primary/5",
};

const STATUS_DOT = {
  online: "bg-green-400",
  standby: "bg-yellow-400",
  offline: "bg-primary/30",
};

function Section({ icon: Icon, title, children, accent = "primary" }) {
  const accentClass =
    accent === "amber"
      ? "text-amber-400/70"
      : accent === "rose"
        ? "text-rose-400/70"
        : accent === "violet"
          ? "text-violet-400/70"
          : "text-primary/50";

  return (
    <section className="space-y-2">
      <h3 className={`flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] uppercase ${accentClass}`}>
        {Icon ? <Icon className="w-3 h-3" /> : null}
        {title}
      </h3>
      <div className="p-3 bg-black/40 border border-primary/10 space-y-2">
        {children}
      </div>
    </section>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="font-mono text-[8px] text-primary/35 tracking-[0.2em] uppercase mb-1">{label}</p>
      <p className="text-[11px] font-mono text-primary/75 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function normalizeTraits(traits) {
  if (!traits) return [];
  if (Array.isArray(traits)) {
    return traits.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(traits)
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Dossier overlay opened by tapping a character photo.
 * Surfaces biological makeup, backstory, rap-sheet, and unique details.
 */
export default function CharacterBioSheet({ character, open = true, onClose }) {
  useEffect(() => {
    if (!open || !character) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, character, onClose]);

  if (!character) return null;

  const traits = normalizeTraits(character.traits);
  const categoryClass = CATEGORY_COLORS[character.category] || CATEGORY_COLORS.other;
  const statusDot = STATUS_DOT[character.status] || STATUS_DOT.online;
  const hasMakeup =
    character.category ||
    character.universe ||
    character.status ||
    traits.length > 0 ||
    character.tagline;
  const hasRapSheet = character.personality || character.speaking_style;
  const uniques = [
    character.creation_method && { label: "Origin", value: String(character.creation_method).replace(/_/g, " ") },
    character.memory_depth != null && { label: "Memory Depth", value: String(character.memory_depth) },
    character.crossover_preference && { label: "Crossover Preference", value: String(character.crossover_preference) },
    character.elevenlabs_voice_id && { label: "Voice Signature", value: "Linked" },
    character.is_starter && { label: "Roster", value: "Starter cast" },
  ].filter(Boolean);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`${character.name} bio sheet`}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[90vh] bg-background border border-primary/30 sm:rounded-lg shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header / mugshot */}
            <div className="relative flex-shrink-0 border-b border-primary/20 bg-black/70">
              <div className="absolute inset-0 opacity-30 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(0,229,229,0.18),transparent_55%)]" />
              <div className="relative flex items-stretch gap-4 p-4 sm:p-5">
                <div className="w-24 h-28 sm:w-28 sm:h-32 border border-primary/40 overflow-hidden bg-primary/10 flex-shrink-0">
                  {character.avatar_url ? (
                    <img
                      src={character.avatar_url}
                      alt={character.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-mono text-primary/40 text-3xl">
                      {character.name?.[0] || "?"}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5 pr-8">
                  <p className="font-mono text-[8px] text-primary/40 tracking-[0.35em] uppercase">
                    // Bio Sheet
                  </p>
                  <h2 className="font-mono text-lg sm:text-xl text-primary tracking-[0.15em] uppercase truncate">
                    {character.name}
                  </h2>
                  {character.universe && (
                    <p className="text-[10px] font-mono text-primary/45 tracking-widest truncate">
                      {character.universe}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {character.category && (
                      <span className={`inline-block text-[9px] font-mono tracking-[0.2em] uppercase border px-2 py-0.5 ${categoryClass}`}>
                        {character.category}
                      </span>
                    )}
                    {character.status && (
                      <span className="inline-flex items-center gap-1.5 text-[9px] font-mono text-primary/50 tracking-widest uppercase">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                        {character.status}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute top-3 right-3 text-primary/30 hover:text-primary transition-colors p-1"
                  aria-label="Close bio sheet"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable dossier body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {hasMakeup && (
                <Section icon={Fingerprint} title="Biological Makeup" accent="primary">
                  {character.tagline && <Field label="Designation" value={character.tagline} />}
                  <div className="grid grid-cols-2 gap-3">
                    {character.universe && <Field label="Universe of Origin" value={character.universe} />}
                    {character.category && <Field label="Classification" value={character.category} />}
                    {character.status && <Field label="Current Status" value={character.status} />}
                  </div>
                  {traits.length > 0 && (
                    <div>
                      <p className="font-mono text-[8px] text-primary/35 tracking-[0.2em] uppercase mb-1.5">
                        Trait Markers
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {traits.map((trait) => (
                          <span
                            key={trait}
                            className="text-[9px] font-mono text-primary/70 border border-primary/20 bg-primary/5 px-2 py-0.5 tracking-wide"
                          >
                            {trait}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {character.backstory && (
                <Section icon={BookOpen} title="Backstory" accent="violet">
                  <p className="text-[11px] font-mono text-primary/75 leading-relaxed whitespace-pre-wrap">
                    {character.backstory}
                  </p>
                </Section>
              )}

              {hasRapSheet && (
                <Section icon={ScrollText} title="Rap Sheet" accent="rose">
                  <Field label="Behavioral Profile" value={character.personality} />
                  <Field label="Speech Pattern" value={character.speaking_style} />
                </Section>
              )}

              {(uniques.length > 0 || character.system_prompt) && (
                <Section icon={Sparkles} title="Uniques & Details" accent="amber">
                  {uniques.map((item) => (
                    <Field key={item.label} label={item.label} value={item.value} />
                  ))}
                  {character.system_prompt && (
                    <Field
                      label="Directive Notes"
                      value={
                        character.system_prompt.length > 420
                          ? `${character.system_prompt.slice(0, 420).trim()}…`
                          : character.system_prompt
                      }
                    />
                  )}
                </Section>
              )}

              {!hasMakeup && !character.backstory && !hasRapSheet && uniques.length === 0 && !character.system_prompt && (
                <p className="text-[11px] font-mono text-primary/40 text-center py-8 tracking-widest uppercase">
                  No dossier entries on file.
                </p>
              )}
            </div>

            <div className="flex-shrink-0 px-4 sm:px-5 py-3 border-t border-primary/20 bg-black/60">
              <button
                type="button"
                onClick={onClose}
                className="w-full px-4 py-2 border border-primary/25 text-primary/50 hover:text-primary hover:border-primary/50 font-mono text-[10px] tracking-[0.25em] uppercase transition-all"
              >
                Close Dossier
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
