import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X, Search, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import StoryTemplateBrowser from "@/components/templates/StoryTemplateBrowser";
import CanonicalStoriesBrowser from "@/components/stories/CanonicalStoriesBrowser";
import StoryCharacterChooser from "@/components/stories/StoryCharacterChooser";
import { useTimelineBranching } from "@/hooks/useTimelineBranching";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { useStoreSync } from "@/lib/useStoreSync";
import {
  getBundledStarterRoster,
  loadRosterCharacters,
} from "@/lib/loadRosterCharacters";
import { upsertCharacters } from "@/lib/seedCharacters";
import {
  initSessionErrorMessage,
  remapSelectedCharacterIds,
} from "@/lib/createInitSession";

export default function NewSessionModal({ mode, onClose, onCreate }) {
  const navigate = useNavigate();
  const { createBranchForSession } = useTimelineBranching();
  // Paint bundled starters immediately so Select Character is never blank while
  // store auth / seeding runs (and so a later empty store-sync cannot flash empty).
  const [characters, setCharacters] = useState(getBundledStarterRoster);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [loadError, setLoadError] = useState(
    "Loading account characters — starters are shown until sync finishes.",
  );
  const [usingBundledSeed, setUsingBundledSeed] = useState(true);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState("characters"); // "characters", "templates", "stories", "canonical"
  const [showStoryChooser, setShowStoryChooser] = useState(false);
  const [canonSeed, setCanonSeed] = useState(null); // { story, insertions } from the universe browser
  const [openingScene, setOpeningScene] = useState("");

  const loadData = useCallback(async ({ retrySeed = false } = {}) => {
    // Keep current roster visible while refreshing — never blank the grid.
    if (retrySeed) setSeeding(true);
    else setLoading(true);
    try {
      // Load roster and groups independently — a CharacterGroup failure must not
      // wipe a successful character roster (Promise.all rejection used to).
      const rosterResult = await loadRosterCharacters({
        retrySeed,
        waitBootstrap: false,
        allowBundledFallback: true,
      });
      let grps = [];
      try {
        grps = await base44.entities.CharacterGroup.list("-created_date", 100);
      } catch (groupErr) {
        console.warn(
          "[Anima] CharacterGroup list failed:",
          groupErr?.message || groupErr,
        );
        grps = [];
      }
      const nextChars = rosterResult?.characters || [];
      // Never replace a visible roster with [] — store-sync races used to wipe
      // bundled starters right after they appeared.
      if (nextChars.length) {
        setCharacters(nextChars);
        setUsingBundledSeed(!!rosterResult?.usingBundledSeed);
      } else {
        setCharacters((prev) =>
          prev.length ? prev : getBundledStarterRoster(),
        );
        setUsingBundledSeed(true);
      }
      setGroups(grps || []);
      if (rosterResult?.usingBundledSeed || !nextChars.length) {
        const reason = rosterResult?.error?.message;
        setLoadError(
          reason
            ? `${reason}. Showing starter characters — starting a chat saves them to your account.`
            : "Showing starter characters — starting a chat saves them to your account.",
        );
      } else {
        setLoadError(null);
      }
    } catch (err) {
      console.error('Error loading characters:', err);
      setCharacters((prev) => (prev.length ? prev : getBundledStarterRoster()));
      setUsingBundledSeed(true);
      setLoadError(
        `${err?.message || "Could not load characters"}. Showing starter characters — starting a chat saves them to your account.`,
      );
    } finally {
      setSeeding(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    whenBootstrapReady().then(() => {
      // Retry starter seed if the roster is still empty so New Session can
      // offer preloaded characters immediately after sign-in.
      if (!cancelled) loadData({ retrySeed: true });
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // Refetch when starter seeding or another device updates the roster.
  useStoreSync(() => loadData({ retrySeed: false }));

  const filteredCharacters = characters.filter((c) => {
    const searchLower = search.toLowerCase().trim();
    if (!searchLower) return true;
    return (
      (c.name || "").toLowerCase().includes(searchLower) ||
      (c.universe || "").toLowerCase().includes(searchLower) ||
      (c.category || "").toLowerCase().includes(searchLower)
    );
  });

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.description || "").toLowerCase().includes(search.toLowerCase())
  );

  const selectedCharacters = characters.filter((c) => selected.includes(c.id));
  const selectedUniverses = Array.from(
    new Set(selectedCharacters.map((c) => c.universe).filter(Boolean)),
  );
  const isCrossover = mode === "group" && selectedUniverses.length >= 2;

  const toggleSelect = (id, isGroup = false) => {
    if (isGroup) {
      const group = groups.find((g) => g.id === id);
      if (!group) return;
      const groupCharIds = group.character_ids || [];
      setSelected((prev) => {
        const allSelected = new Set(prev);
        const allGroupSelected = groupCharIds.every((cid) => allSelected.has(cid));
        if (allGroupSelected) {
          groupCharIds.forEach((cid) => allSelected.delete(cid));
        } else {
          groupCharIds.forEach((cid) => {
            if (allSelected.size < 40) allSelected.add(cid);
          });
        }
        return Array.from(allSelected);
      });
    } else {
      if (mode === "solo") {
        setSelected([id]);
      } else {
        setSelected((prev) => {
          if (prev.includes(id)) {
            return prev.filter((s) => s !== id);
          } else if (prev.length < 40) {
            return [...prev, id];
          }
          return prev;
        });
      }
    }
  };

  const sessionCreateErrorMessage = (err) => initSessionErrorMessage(err);

  const handleCreate = async () => {
    if (selected.length === 0 || creating) return;
    setCreating(true);
    setLoadError(null);

    // Bundled starters are not in Postgres yet — upsert before chat so the
    // session can resolve character ids from the store. Remap picker ids onto
    // the upsert response so create never receives a leftover seed id.
    const bundledSelected = selectedCharacters.filter((c) => c._bundled);
    let selectedIds = selected;
    try {
      if (bundledSelected.length) {
        const upserted = await upsertCharacters(
          bundledSelected.map(({ _bundled, ...rest }) => rest),
          { skipExistingLookup: true },
        );
        selectedIds = remapSelectedCharacterIds(
          selected,
          bundledSelected,
          upserted?.items,
          upserted?.idMap,
        );
        const storeIds = new Set(
          (upserted?.items || []).map((item) => item?.id).filter(Boolean),
        );
        const staleBundled = bundledSelected.some((character) => {
          const nextId = selectedIds[selected.indexOf(character.id)];
          return storeIds.size > 0 && nextId === character.id && !storeIds.has(character.id);
        });
        if (staleBundled) {
          throw new Error(
            "Could not match the selected starter to a store character. Tap Init to try again.",
          );
        }
        const remappedByOldId = new Map(
          selected.map((id, index) => [id, selectedIds[index]]),
        );
        setCharacters((prev) =>
          prev.map((c) => {
            if (!c._bundled) return c;
            const nextId = remappedByOldId.get(c.id) || c.id;
            return { ...c, id: nextId, _bundled: false };
          }),
        );
        setUsingBundledSeed(false);
      }

      const rosterById = new Map(
        characters.map((c) => [c.id, c]),
      );
      selectedIds.forEach((id, index) => {
        const previous = selected[index];
        if (id !== previous && rosterById.has(previous)) {
          rosterById.set(id, { ...rosterById.get(previous), id, _bundled: false });
        }
      });
      const resolvedSelected = selectedIds
        .map((id) => rosterById.get(id))
        .filter(Boolean);

      // Prepare session data
      const sessionData = mode === "solo"
        ? {
            mode,
            character_id: selectedIds[0],
            character: resolvedSelected[0] || selectedCharacters[0] || null,
            opening_scene: openingScene.trim() || undefined,
          }
        : {
            mode,
            group_character_ids: selectedIds,
            group_characters: resolvedSelected,
            selected_character_names: resolvedSelected.map((c) => c.name),
            crossover_universes: selectedUniverses,
            is_crossover: isCrossover,
            shared_memory: [],
            opening_scene: openingScene.trim() || undefined,
          };

      const newSession = await onCreate(sessionData);

      // After a brief delay, create timeline branch for the new session.
      setTimeout(async () => {
        try {
          const sessionForBranch =
            newSession ||
            (await base44.entities.ChatSession.list("-created_date", 1))?.[0];
          if (sessionForBranch) {
            await createBranchForSession(sessionForBranch, characters, mode);
          }
        } catch (err) {
          console.error("Error creating timeline branch:", err);
        }
      }, 500);
    } catch (err) {
      const message = sessionCreateErrorMessage(err);
      setLoadError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleSelectTemplate = (template) => {
    if (template.character_bases?.length > 0) {
      if (mode === "solo") {
        setSelected([template.character_bases[0].id || template.character_bases[0].name]);
      } else {
        setSelected(template.character_bases.slice(0, 40).map(c => c.id || c.name));
      }
    }
    setView("characters");
  };

  const handleCreateFromChooser = (session) => {
    navigate(`/chat/${session.id}`);
    setShowStoryChooser(false);
    setCanonSeed(null);
    onClose?.();
  };

  // The universe browser fires onSelectStory(story) when a story is picked and
  // again with (story, point) once an insertion point is chosen. Only act on the
  // point selection: hand off to the character chooser, seeded with this story
  // and point, so the user picks who they'll be and the session is created.
  const handleCanonSelect = (story, point) => {
    if (!point) return;
    setCanonSeed({ story, insertions: [point] });
    setShowStoryChooser(true);
  };

  const categoryColors = {
    companion: "text-cyan-400",
    warrior: "text-red-400",
    mystic: "text-purple-400",
    scientist: "text-green-400",
    villain: "text-orange-400",
    hero: "text-yellow-400",
    other: "text-primary/50",
    // Anima archetypes
    guardian: "text-cyan-400",
    muse: "text-pink-400",
    sage: "text-purple-400",
    trickster: "text-yellow-400",
    shadow: "text-red-400",
    lover: "text-rose-400",
    explorer: "text-green-400",
    oracle: "text-blue-400",
  };

  return createPortal(
    <div
      data-testid="new-session-overlay"
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-end h-app-viewport bg-black/80 backdrop-blur-sm p-4 pb-[calc(var(--tab-bar-height,56px)+env(safe-area-inset-bottom,0px)+1rem)] min-h-0 overflow-hidden"
      style={{
        top: 0,
        left: 0,
        right: 0,
        height: "var(--app-height, 100dvh)",
        maxHeight: "var(--app-height, 100dvh)",
      }}
    >
      {/*
        Portaled to document.body so `fixed` is vs the viewport, not Chat
        overflow-hidden / ProtocolApp motion.div transform. z-[1000] covers
        the tab bar (z-[999]); sign-out already uses this overlay token.
        h-app-viewport / --app-height keeps iOS off the large-viewport trap
        where URL bar + tab bar sit outside inset-0. justify-end keeps Init
        on-screen when Opening Scene + footer wrap. The character list is
        the only scroller.
      */}
      <div
        data-testid="new-session-panel"
        className="w-full max-w-2xl min-h-0 max-h-full flex-1 sm:flex-none flex flex-col overflow-hidden bg-background border border-primary/30 hud-corner glow-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-primary/20 gap-3 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-base sm:text-lg truncate">
              {view === "templates"
                ? "// Story Templates"
                : mode === "solo"
                ? "// Select Character"
                : "// Assemble Group"}
            </h2>
            <p className="text-[10px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
              {view === "templates"
                ? "Pre-built character groups from popular universes"
                : view === "canonical"
                ? "Join canonical stories from beloved series"
                : mode === "solo"
                ? "Choose one character to interface with"
                : `${selected.length}/40 characters selected`}
            </p>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors flex-shrink-0">
            <X className="w-4 sm:w-5 h-4 sm:h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-primary/10 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search characters or universes..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        </div>

        {/* Content — sole touch scroller; min-h-0 so flex can shrink it. */}
        <div
          data-testid="new-session-character-scroller"
          className="flex-1 overflow-y-auto overscroll-contain p-4 min-h-0 touch-pan-y"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {view === "templates" ? (
            <StoryTemplateBrowser
              onSelectTemplate={handleSelectTemplate}
              onClose={() => setView("characters")}
              isInline={true}
            />
          ) : view === "canonical" ? (
            <CanonicalStoriesBrowser
              onSelectStory={handleCanonSelect}
              isInline={true}
            />
          ) : filteredCharacters.length === 0 && filteredGroups.length === 0 && (loading || seeding) ? (
            <div className="text-center py-12 font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
              {seeding ? "Indexing starter characters..." : "Loading characters..."}
            </div>
          ) : filteredCharacters.length === 0 && filteredGroups.length === 0 ? (
            <div className="text-center py-12">
              <p className="font-mono text-primary/30 text-sm tracking-widest uppercase mb-4">No results found</p>
              {loadError && (
                <p className="font-mono text-[10px] text-amber-400/80 max-w-md mx-auto mb-4 leading-relaxed">
                  {loadError}
                </p>
              )}
              <button
                type="button"
                onClick={() => loadData({ retrySeed: true })}
                className="font-mono text-xs text-primary/70 hover:text-primary underline tracking-widest uppercase transition-colors mb-3 block mx-auto"
              >
                Retry loading starters
              </button>
              <a href="/characters" className="font-mono text-xs text-primary/50 hover:text-primary underline tracking-widest uppercase transition-colors">
                + Create a character
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {loadError && usingBundledSeed && (
                <p className="font-mono text-[10px] text-amber-400/80 leading-relaxed border border-amber-400/20 bg-amber-400/5 px-3 py-2">
                  {loadError}
                </p>
              )}
              {loadError && !usingBundledSeed && (
                <p className="font-mono text-[10px] text-red-300/90 leading-relaxed border border-red-400/30 bg-red-500/5 px-3 py-2">
                  {loadError}
                </p>
              )}
              {filteredGroups.length > 0 && mode === "group" && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Quick Add Group</p>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        toggleSelect(e.target.value, true);
                        e.target.value = "";
                      }
                    }}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="">+ Select a group...</option>
                    {filteredGroups.map((group) => {
                      const groupCharIds = group.character_ids || [];
                      return (
                        <option key={group.id} value={group.id}>
                          {group.name} ({groupCharIds.length} members)
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              {filteredCharacters.length > 0 && (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredCharacters.map((char) => {
                      const isSelected = selected.includes(char.id);
                      return (
                        <button
                          key={char.id}
                          onClick={() => toggleSelect(char.id)}
                          className={`relative p-4 border text-left transition-all hud-corner ${
                            isSelected
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40 hover:bg-primary/5"
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-4 h-4 bg-primary flex items-center justify-center">
                              <Check className="w-3 h-3 text-background" />
                            </div>
                          )}
                          {char.avatar_url ? (
                            <img src={char.avatar_url} alt={char.name} className="w-12 h-12 object-cover border border-primary/20 mb-3" />
                          ) : (
                            <div className="w-12 h-12 bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                              <span className="font-mono text-primary text-lg">{(char.name || "?")[0]}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <p className="font-mono text-xs tracking-wider uppercase truncate">{char.name}</p>
                            {char._isAnima && (
                              <span className="text-[8px] font-mono text-pink-400/70 tracking-widest flex-shrink-0">✦</span>
                            )}
                          </div>
                          {char._isAnima ? (
                            <p className="text-[9px] font-mono text-pink-400/40 truncate mt-0.5 tracking-widest">Anima</p>
                          ) : char.universe ? (
                            <p className="text-[9px] font-mono text-primary/30 truncate mt-0.5 tracking-widest">{char.universe}</p>
                          ) : null}
                          {char.category && (
                            <p className={`text-[9px] font-mono tracking-widest uppercase mt-1 ${categoryColors[char.category] || "text-primary/40"}`}>
                              {char.category}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Opening Scene Input */}
        {view === "characters" && selected.length > 0 && (
          <div className="px-4 py-3 border-t border-primary/10 bg-black/20 flex-shrink-0">
            {mode === "group" && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={`text-[8px] font-mono tracking-widest uppercase border rounded px-2 py-1 ${
                  isCrossover
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-primary/20 bg-primary/5 text-primary/40"
                }`}>
                  {isCrossover ? "Crossover Ready" : "Single Universe"}
                </span>
                {selectedUniverses.slice(0, 4).map((universe) => (
                  <span
                    key={universe}
                    className="text-[8px] font-mono tracking-widest uppercase border border-primary/15 bg-black/40 text-primary/50 rounded px-2 py-1"
                  >
                    {universe}
                  </span>
                ))}
                {selectedUniverses.length > 4 && (
                  <span className="text-[8px] font-mono tracking-widest uppercase text-primary/30">
                    +{selectedUniverses.length - 4}
                  </span>
                )}
              </div>
            )}
            <label className="block font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1.5">
              Opening Scene <span className="text-primary/20">(optional)</span>
            </label>
            <textarea
              value={openingScene}
              onChange={(e) => setOpeningScene(e.target.value)}
              placeholder="Set the scene... describe where the story begins, the mood, or write an opening narration."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
              rows={3}
            />
          </div>
        )}

        {/* Footer */}
         <div className="p-3 sm:p-4 border-t border-primary/20 flex flex-wrap items-center justify-between gap-2 sm:gap-4 flex-shrink-0">
           <div className="flex items-center gap-1 sm:gap-2 text-[9px] sm:text-xs flex-wrap">
             {view === "characters" ? (
               <>
                 <a
                   href="/characters"
                   className="text-primary/40 hover:text-primary font-mono tracking-widest uppercase transition-colors whitespace-nowrap"
                 >
                   <Plus className="inline w-2.5 h-2.5 mr-1" />New Character
                 </a>
                 <span className="text-primary/20">•</span>
                 <button
                   onClick={() => setShowStoryChooser(true)}
                   className="text-primary/40 hover:text-primary font-mono tracking-widest uppercase transition-colors whitespace-nowrap"
                 >
                   Story Chooser
                 </button>
                 <span className="text-primary/20">•</span>
                 <button
                   onClick={() => setView("canonical")}
                   className="text-primary/40 hover:text-primary font-mono tracking-widest uppercase transition-colors whitespace-nowrap"
                 >
                   Canon Stories
                 </button>
                 <span className="text-primary/20">•</span>
                 <button
                   onClick={() => setView("templates")}
                   className="text-primary/40 hover:text-primary font-mono tracking-widest uppercase transition-colors whitespace-nowrap"
                 >
                   Templates
                 </button>

               </>
             ) : (
               <button
                 onClick={() => {
                   setView("characters");
                 }}
                 className="text-primary/40 hover:text-primary font-mono text-xs tracking-widest uppercase transition-colors"
               >
                 ← Back
               </button>
             )}
           </div>
           <div className="flex gap-2 sm:gap-3">
             <button
               onClick={onClose}
               className="px-3 sm:px-6 py-1.5 sm:py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-[9px] sm:text-xs tracking-widest uppercase transition-all whitespace-nowrap"
             >
               Cancel
             </button>
             {view === "characters" && (
               <button
                 onClick={handleCreate}
                 disabled={selected.length === 0 || creating}
                 className="px-3 sm:px-6 py-1.5 sm:py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[9px] sm:text-xs tracking-widest uppercase transition-all hud-corner glow-border whitespace-nowrap"
               >
                 {creating ? "Saving…" : "Init"}
               </button>
             )}
           </div>
         </div>
      </div>

      {showStoryChooser && (
        <StoryCharacterChooser
          onClose={() => {
            setShowStoryChooser(false);
            setCanonSeed(null);
          }}
          onCreateSession={handleCreateFromChooser}
          initialStory={canonSeed?.story || null}
          initialInsertions={canonSeed?.insertions || null}
        />
      )}
    </div>,
    document.body,
  );
}
