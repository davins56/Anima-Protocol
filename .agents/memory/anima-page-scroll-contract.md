---
name: Anima page scroll contract
description: How page roots must be structured so content isn't clipped behind the fixed bottom tab bar
---

# Anima page scroll contract

The app shell (`App.full.jsx`) is a fixed-height flex column: top-level `flex flex-col h-screen-safe`, then the route wrapper `motion.div` is `flex-1 min-h-0 flex flex-col` with `paddingBottom: var(--tab-bar-height)`. The `BottomTabBar` is `position: fixed`. So the wrapper already reserves bottom clearance for the tab bar.

**Rule for every page root (the element a page `return`s):**
- It is the single flex child of the wrapper, so make it `flex-1 min-h-0`.
- If the page is plain/stacked content (the root itself should scroll): `flex-1 min-h-0 overflow-y-auto`.
- If the page is a fixed flex layout with its own inner scroll pane(s) (e.g. a header + `flex-1 overflow-y-auto` body, or a graph in `overflow-hidden`): root is `flex-1 min-h-0` (NO root overflow) and let the inner pane scroll. Inner scroll panes need `min-h-0` to actually shrink.
- Centered loader/empty states: `flex-1 min-h-0 flex items-center justify-center`.

**Why:** `min-h-screen` / `h-screen` / `min-h-[100dvh]` / `h-[100dvh]` as a page root breaks out of the wrapper's height flow (forces full-viewport height inside a shorter wrapper) so the bottom of the page sits under the fixed tab bar and can't be scrolled to. There is no document/body scroll — scrolling must happen inside a `flex-1 min-h-0 overflow-y-auto` container.

**How to apply:** Never use viewport-height utilities (`*-screen`, `*-[100dvh]`) on a page root. Do not add per-page bottom padding for the tab bar (`mobile-page-padding`, `paddingBottom: var(--tab-bar-height,...)`) — the wrapper already provides it; adding it again just creates a redundant gap. Chat.jsx keeps its own `var(--tab-bar-height,60px)` because its composer layout depends on it — leave it.
