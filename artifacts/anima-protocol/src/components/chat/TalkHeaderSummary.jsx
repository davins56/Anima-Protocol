// @ts-check
import VesselPortrait from "@/components/vessel/VesselPortrait";
import AffectCue from "@/components/chat/AffectCue";
import { useEmotionCues } from "@/components/chat/EmotionCuesContext";

/**
 * Compact one-line companion header: avatar, name, and online/group status.
 *
 * @param {{
 *   session?: { mode?: string, title?: string, character_id?: string, group_character_ids?: string[] } | null,
 *   characters?: Array<{ id: string, name: string, avatar_url?: string }>,
 *   characterEmotions?: Record<string, { emotion?: string, intensity?: number }>,
 *   onAvatarClick?: (character: { id: string, name: string }) => void,
 * }} props
 */
export default function TalkHeaderSummary({ session, characters = [], characterEmotions, onAvatarClick }) {
  const isGroup = session?.mode === "group";
  const charIds = isGroup
    ? session.group_character_ids || []
    : session?.character_id
      ? [session.character_id]
      : [];
  const activeChars = characters.filter((c) => charIds.includes(c.id));
  const primaryChar = activeChars[0];
  const name = session?.title || (isGroup ? "Group" : primaryChar?.name || "Session");
  const status = isGroup ? `${activeChars.length} active` : "Online";
  // #765: with ANIMA_EMOTIONS on, a soft cue replaces the feeling label.
  const emotionCues = useEmotionCues();
  const cuesOn = emotionCues.enabled === true;
  const primaryCue = cuesOn && !isGroup && primaryChar?.id ? emotionCues.cueFor(primaryChar.id) : null;
  const feeling = !cuesOn && !isGroup ? characterEmotions?.[primaryChar?.id]?.emotion : null;

  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="talk-header-summary">
      {isGroup ? (
        <div className="flex -space-x-1.5 flex-shrink-0">
          {activeChars.slice(0, 3).map((char, i) => (
            <span
              key={char.id}
              className="w-6 h-6 border border-primary/40 bg-primary/10 overflow-hidden flex-shrink-0"
              style={{ zIndex: 3 - i }}
            >
              {char.avatar_url ? (
                <img src={char.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center font-mono text-primary text-[10px]">
                  {char.name?.[0]}
                </span>
              )}
            </span>
          ))}
        </div>
      ) : primaryChar ? (
        <button
          type="button"
          onClick={() => onAvatarClick?.(primaryChar)}
          title={`View ${primaryChar.name} bio sheet`}
          className="w-6 h-6 border border-primary/40 overflow-hidden flex-shrink-0 hover:border-primary/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
        >
          <VesselPortrait
            characterId={primaryChar.id}
            name={primaryChar.name}
            mood={characterEmotions?.[primaryChar.id]?.emotion}
            intensity={characterEmotions?.[primaryChar.id]?.intensity}
            dims={primaryCue?.dims || undefined}
            fallback={
              primaryChar.avatar_url ? (
                <img src={primaryChar.avatar_url} alt={primaryChar.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-primary/10 flex items-center justify-center font-mono text-primary text-[10px]">
                  {primaryChar.name[0]}
                </div>
              )
            }
          />
        </button>
      ) : null}
      <span className="font-mono text-[9px] sm:text-xs text-primary tracking-[0.2em] uppercase truncate">
        {name}
      </span>
      <span className="flex items-center gap-1 flex-shrink-0">
        <span className="w-1 h-1 bg-primary rounded-full" aria-hidden="true" />
        <span className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase">
          {status}
        </span>
      </span>
      {cuesOn && !isGroup && primaryChar?.id ? (
        <AffectCue
          cue={primaryCue}
          name={primaryChar.name}
          reunion={emotionCues.reunionIds.includes(primaryChar.id)}
          size="sm"
          testId="talk-header-summary-cue"
        />
      ) : null}
      {feeling ? (
        <span
          data-testid="talk-header-summary-feeling"
          className="text-[8px] sm:text-[9px] font-mono uppercase tracking-widest text-primary/60 truncate flex-shrink-0"
        >
          {feeling}
        </span>
      ) : null}
    </div>
  );
}
