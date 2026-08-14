---
name: Anima typecheck scope
description: What the anima-protocol typecheck covers (allowJs on, checkJs off) and how to extend it.
---

# Anima-protocol typecheck scope

The `typecheck` script (`tsc -p tsconfig.json --noEmit`) and the registered
`typecheck` validation step run with **`allowJs: true`** so every `.js`/`.jsx`
file (pages, hooks, most components) is part of the type-check program, not just
the `.ts`/`.tsx` files. This catches grammar/structural errors across the whole
app (e.g. duplicate JSX attributes report as TS17001).

**checkJs is intentionally off.** Deep type checking of the JS codebase surfaces
thousands (~6.7k) of pre-existing errors, so full `checkJs` is not flipped on
globally. Adopt it **incrementally per file** with a top-of-file `// @ts-check`
(only ~78 of ~505 JS files are currently clean enough to do this for free).

**How to apply:**
- Want real type checking on a specific JS file? Add `// @ts-check` at the top
  and fix what it surfaces. Don't enable `checkJs` project-wide.
- JS modules imported from `.tsx` files cause `TS7016 (no declaration file)`. The
  fix is a colocated `.d.ts` (see `src/api/base44Client.d.ts` typing the
  server-backed base44 client loosely — entity records are `any`, call shapes
  are accurate). Add similar `.d.ts` files for other JS modules a `.tsx` imports.
- `src/components/mockups/**` is excluded from typecheck: it's an orphaned scratch
  area, NOT wired to the mockup-sandbox artifact (that artifact loads mockups from
  its own `artifacts/mockup-sandbox/src/components/mockups/`).
