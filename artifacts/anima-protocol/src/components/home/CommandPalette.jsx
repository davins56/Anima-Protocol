// @ts-check
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useModelTutor } from "@/hooks/useModelTutor";
import { DOCK_TABS, EXPLORE_MODULES, dockTabForPath, exploreModules } from "@/lib/mobileNav";
import { commandEntries } from "@/lib/navigationPattern";

/**
 * @param {string} tabPath
 * @param {string} pathname
 */
function pathIsActive(tabPath, pathname) {
  const pathOnly = tabPath.split("?")[0];
  if (pathOnly === "/") return pathname === "/";
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

/**
 * Searchable command palette for Navigation: Command. Lists the five dock
 * destinations and every Explore module (steward filter applied), so it
 * reaches exactly what the dock + Explore reach.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onSelect: (entry: import("@/lib/navigationPattern").CommandEntry) => void,
 * }} props
 */
export default function CommandPalette({ open, onClose, onSelect }) {
  const location = useLocation();
  const { isSteward } = useModelTutor();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const dialogRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const returnFocusRef = useRef(/** @type {HTMLElement | null} */ (null));
  const listId = useId();
  const modules = useMemo(() => exploreModules(EXPLORE_MODULES, { isSteward }), [isSteward]);
  const entries = useMemo(() => commandEntries(DOCK_TABS, modules, query), [modules, query]);
  const activeTab = dockTabForPath(location.pathname);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIndex(0);
      return undefined;
    }
    // Remember the trigger, focus the search field, and hand focus back on close.
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    inputRef.current?.focus();
    return () => {
      const back = returnFocusRef.current;
      if (back && back.isConnected) back.focus();
    };
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  // Keep the keyboard selection visible in the scrolling list.
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`${listId}-opt-${index}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, index, listId]);

  if (!open) return null;

  /** Trap Tab inside the modal palette. @param {import("react").KeyboardEvent<HTMLDivElement>} e */
  const trapTab = (e) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll("input, button, [href], [tabindex]:not([tabindex='-1'])"),
    ).filter((el) => el instanceof HTMLElement && !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const first = /** @type {HTMLElement} */ (items[0]);
    const last = /** @type {HTMLElement} */ (items[items.length - 1]);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /** @param {import("@/lib/navigationPattern").CommandEntry} entry */
  const isCurrent = (entry) =>
    entry.kind === "tab" ? entry.id === activeTab : Boolean(entry.path && pathIsActive(entry.path, location.pathname));

  /** @param {import("@/lib/navigationPattern").CommandEntry | undefined} entry */
  const choose = (entry) => {
    if (!entry) return;
    onSelect(entry);
  };

  /** @param {import("react").KeyboardEvent<HTMLInputElement>} e */
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (entries.length ? (i + 1) % entries.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (entries.length ? (i - 1 + entries.length) % entries.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(entries[index]);
    }
  };

  const optionId = (/** @type {number} */ i) => `${listId}-opt-${i}`;

  return (
    <>
      <div className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-sm" data-no-swipe onClick={onClose} />
      <div
        ref={dialogRef}
        onKeyDown={trapTab}
        role="dialog"
        aria-modal="true"
        aria-label="Go to"
        data-testid="command-palette"
        data-glass-surface="modal"
        data-no-swipe
        className="fixed left-1/2 z-[1001] w-[92%] max-w-lg -translate-x-1/2 border border-border bg-card text-foreground shadow-2xl"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--app-height, 100dvh) * 0.08)" }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={entries.length ? optionId(index) : undefined}
            aria-label="Go to a page"
            data-testid="command-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            className="min-h-11 w-full bg-transparent font-mono text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button type="button" onClick={onClose} aria-label="Close command palette" className="p-2 text-muted-foreground hover:text-[hsl(var(--primary))]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label="Destinations" className="overflow-y-auto overscroll-contain py-1"
          // --app-height tracks the keyboard-visible viewport on iOS, so the
          // list never runs behind the software keyboard.
          style={{ maxHeight: "min(55dvh, calc(var(--app-height, 100dvh) * 0.92 - var(--app-height, 100dvh) * 0.08 - 4.5rem))" }}>
          {entries.length === 0 && (
            <li className="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              No pages match “{query.trim()}”
            </li>
          )}
          {entries.map((entry, i) => {
            const current = isCurrent(entry);
            return (
              <li
                key={entry.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === index}
                aria-current={current ? "page" : undefined}
                data-command-entry={entry.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(entry)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] ${
                  i === index ? "bg-primary/10 text-[hsl(var(--primary))]" : "text-foreground"
                }`}
              >
                <span className="w-5 text-center" aria-hidden="true">{entry.icon || "›"}</span>
                <span className="flex-1">{entry.label}</span>
                {entry.kind === "tab" && <span className="text-[9px] text-muted-foreground">Tab</span>}
                {current && <span className="text-[9px] text-[hsl(var(--primary))]">Here</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
