import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Moon, MessageCircle } from "lucide-react";
import { animaClient } from "@/api/animaClient";
import { useDreamJournal } from "@/hooks/useDreamJournal";
import { useIsDreaming } from "@/hooks/useIsDreaming";
import {
  WHAT_DID_YOU_DREAM_PROMPT,
  dreamJournalChatPath,
  dreamJournalPagePath,
  formatDreamDate,
  moodTag,
  type DreamJournalEntry,
} from "@/lib/dreamJournal";

function DreamCard({
  dream,
  selected,
  onOpen,
}: {
  dream: DreamJournalEntry;
  selected: boolean;
  onOpen: () => void;
}) {
  const mood = moodTag(dream.mood);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      data-testid={`dream-card-${dream.id}`}
      className={`w-full text-left border px-3 py-3 transition-colors ${
        selected ? "border-indigo-400/50 bg-indigo-950/30" : "border-primary/15 bg-primary/5 hover:border-indigo-400/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <time className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/45" dateTime={dream.created_at}>
          {formatDreamDate(dream.created_at)}
        </time>
        {mood ? (
          <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-indigo-300/80 border border-indigo-400/20 px-1.5 py-0.5">
            {mood}
          </span>
        ) : null}
      </div>
      <p className="font-mono text-[11px] leading-relaxed text-primary/70 line-clamp-3 italic">
        {dream.summary || dream.fragment}
      </p>
    </button>
  );
}

export default function DreamJournal() {
  const { characterId: routeId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const nameFromQuery = searchParams.get("name")?.trim() || "";
  const [companions, setCompanions] = useState<{ id: string; name?: string }[]>([]);
  const [pickerReady, setPickerReady] = useState(!routeId);
  const characterId = routeId || companions[0]?.id || "";
  const companionName =
    nameFromQuery || companions.find((c) => c.id === characterId)?.name || "";

  useEffect(() => {
    let alive = true;
    Promise.all([
      animaClient.entities.Character?.list?.("-updated_date", 50).catch(() => []),
      animaClient.entities.Anima?.list?.().catch(() => []),
    ])
      .then(([characters, animas]) => {
        if (!alive) return;
        const seen = new Set<string>();
        const list: { id: string; name?: string }[] = [];
        for (const item of [...(animas || []), ...(characters || [])]) {
          if (!item?.id || seen.has(item.id)) continue;
          seen.add(item.id);
          list.push({ id: item.id, name: item.name });
        }
        setCompanions(list);
      })
      .finally(() => {
        if (alive) setPickerReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (routeId || !pickerReady || !companions[0]?.id) return;
    navigate(dreamJournalPagePath(companions[0].id, companions[0].name), { replace: true });
  }, [routeId, pickerReady, companions, navigate]);

  const journal = useDreamJournal(characterId || null);
  const continuity = useIsDreaming(characterId || null, { surface: "home", name: companionName });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => journal.dreams.find((d) => d.id === selectedId) || null,
    [journal.dreams, selectedId],
  );

  useEffect(() => {
    setSelectedId(null);
  }, [characterId]);

  const openDream = (dream: DreamJournalEntry) => {
    setSelectedId(dream.id);
    void journal.rememberRead(dream.id);
  };

  const askWhatSheDreamed = () => {
    navigate(dreamJournalChatPath({ characterId: characterId || null, prompt: WHAT_DID_YOU_DREAM_PROMPT }));
  };

  const title = companionName ? `${companionName}'s dreams` : "Dream journal";
  const dreamingOn = journal.dreamingEnabled !== false;

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6 p-4 sm:p-6 bg-background overflow-y-auto lg:overflow-hidden">
      <div className="flex-1 flex flex-col min-h-[40vh] lg:min-h-0 min-w-0">
        <div className="flex items-center gap-4 mb-4">
          <Link
            to="/"
            aria-label="Back to home"
            className="text-primary/40 hover:text-primary transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[9px] tracking-[0.28em] uppercase text-indigo-300/60 flex items-center gap-1.5">
              <Moon className="w-3 h-3" aria-hidden="true" />
              Dream journal
            </p>
            <h1 className="font-mono text-primary glow-text tracking-[0.16em] uppercase truncate">{title}</h1>
          </div>
        </div>

        {companions.length > 1 ? (
          <label className="mb-3 block">
            <span className="sr-only">Companion</span>
            <select
              value={characterId}
              onChange={(e) => {
                const next = companions.find((c) => c.id === e.target.value);
                navigate(dreamJournalPagePath(next?.id, next?.name));
              }}
              className="w-full max-w-sm bg-transparent border border-primary/20 font-mono text-[11px] text-primary/80 px-2 py-2"
            >
              {companions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex items-center justify-between gap-3 border border-primary/15 px-3 py-2 flex-1">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-primary/80">Let her dream</p>
              <p className="font-mono text-[10px] text-primary/45 leading-relaxed">
                {journal.unavailable
                  ? "This setting is not available yet. Turning it off here will not stop new dreams until the server supports it."
                  : dreamingOn
                    ? "She may dream after a quiet spell. Off means no new dreams."
                    : "Dreaming is off for her. Existing dreams stay here."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={dreamingOn}
              aria-label="Let her dream"
              disabled={journal.saving || !characterId || journal.error?.code === "companion_not_found"}
              onClick={() => journal.setLetHerDream(!dreamingOn)}
              data-testid="let-her-dream"
              className={`relative w-11 h-6 rounded-full border flex-shrink-0 disabled:opacity-50 ${
                dreamingOn ? "bg-indigo-400/80 border-indigo-300/50" : "bg-primary/10 border-primary/25"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${
                  dreamingOn ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
          <button
            type="button"
            onClick={askWhatSheDreamed}
            data-testid="ask-what-did-you-dream"
            className="inline-flex items-center justify-center gap-2 border border-indigo-400/30 bg-indigo-950/20 hover:border-indigo-400/60 px-3 py-2 font-mono text-[10px] tracking-[0.18em] uppercase text-indigo-100/80"
          >
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
            What did you dream?
          </button>
        </div>

        {journal.loading && !journal.dreams.length ? (
          <p className="font-mono text-[11px] text-primary/50" role="status">
            Opening her journal…
          </p>
        ) : journal.error?.code === "companion_not_found" ? (
          <p className="font-mono text-[11px] text-primary/60" role="alert">
            That companion could not be found.
          </p>
        ) : journal.unavailable ? (
          <div
            className="border border-indigo-400/20 bg-indigo-950/10 px-4 py-5 space-y-2"
            data-testid="dream-journal-unavailable"
            role="status"
          >
            <p className="font-mono text-[12px] text-primary/80">Dream journal is not available yet.</p>
            <p className="font-mono text-[11px] text-primary/50 leading-relaxed">
              The server already records her dreams, but it does not yet have a way to list them here. You can still ask
              her what she dreamed — the question will be waiting in the chat box, unsent.
            </p>
            {continuity.isDreaming ? (
              <p className="font-mono text-[11px] text-indigo-200/70">{companionName || "She"} is dreaming right now.</p>
            ) : null}
          </div>
        ) : journal.error ? (
          <div className="space-y-2" role="alert">
            <p className="font-mono text-[11px] text-primary/60">
              {journal.error.message || "Her dreams could not be opened."}
            </p>
            <button
              type="button"
              onClick={() => journal.refresh()}
              className="font-mono text-[10px] tracking-[0.18em] uppercase text-indigo-200/70 hover:text-indigo-100"
            >
              Try again
            </button>
          </div>
        ) : journal.dreams.length === 0 ? (
          <p className="font-mono text-[11px] text-primary/50" data-testid="dream-journal-empty">
            {dreamingOn ? "She has no dreams written down yet." : "Dreaming is off, and there are no earlier dreams to reread."}
          </p>
        ) : (
          <ul className="flex-1 overflow-y-auto space-y-2 pr-1" aria-label="Dreams, newest first">
            {journal.dreams.map((dream) => (
              <li key={dream.id}>
                <DreamCard dream={dream} selected={selected?.id === dream.id} onOpen={() => openDream(dream)} />
              </li>
            ))}
          </ul>
        )}

        {journal.hasMore ? (
          <button
            type="button"
            onClick={() => journal.loadMore()}
            disabled={journal.loading}
            className="mt-3 self-start font-mono text-[10px] tracking-[0.18em] uppercase text-primary/50 hover:text-primary/80"
          >
            Load earlier dreams
          </button>
        ) : null}
      </div>

      <aside
        className="lg:w-[22rem] flex-shrink-0 border border-primary/15 bg-primary/[0.03] p-4 min-h-[12rem]"
        aria-live="polite"
      >
        {selected ? (
          <div data-testid="dream-detail">
            <div className="flex items-center justify-between gap-2 mb-3">
              <time className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/45" dateTime={selected.created_at}>
                {formatDreamDate(selected.created_at)}
              </time>
              {moodTag(selected.mood) ? (
                <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-indigo-300/80">
                  {moodTag(selected.mood)}
                </span>
              ) : null}
            </div>
            <p className="font-mono text-[12px] leading-relaxed text-primary/85 whitespace-pre-wrap">{selected.summary}</p>
            {selected.fragment ? (
              <p className="mt-4 font-mono text-[11px] italic leading-relaxed text-indigo-100/70">“{selected.fragment}”</p>
            ) : null}
            {selected.themes?.length ? (
              <p className="mt-4 font-mono text-[9px] tracking-[0.16em] uppercase text-primary/35">
                {selected.themes.join(" · ")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="font-mono text-[11px] text-primary/40">
            Choose a dream to reread it. Nothing is sent to her until you do it yourself in chat.
          </p>
        )}
      </aside>
    </div>
  );
}

