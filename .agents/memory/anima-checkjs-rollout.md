---
name: Anima JS deep-typecheck (// @ts-check) rollout
description: How to incrementally enable checkJs per-file in anima-protocol, and the recurring error shapes it surfaces.
---

# Incremental `// @ts-check` rollout (anima-protocol)

`tsconfig.json` keeps `allowJs: true` + `checkJs: false` on purpose. Deep checking
is adopted per-file by prepending `// @ts-check`; a global flip surfaces ~6,800
pre-existing errors and is explicitly forbidden by the task.

**Finding the safe next batch:** temporarily flip `checkJs: true`, run
`pnpm exec tsc -p tsconfig.json --noEmit`, collect the JS/JSX files that report
ZERO errors, then revert. Files clean under global checkJs are clean under per-file
`@ts-check` (inference is identical; checkJs only toggles whether JS errors are
*reported*). Add `@ts-check` to those first, then pick low-error hotspots.

**Recurring error shapes and the fix that catches the real bug:**
- `useState(null)` infers state type `null`; inside `x && x.prop` / `x?.prop` it
  narrows to `never` → TS2339 "prop does not exist on type 'never'". Fix by typing
  the initial value: `useState(/** @type {Foo | null} */ (null))`.
- A prop defaulted to `undefined` (e.g. `= { cb: undefined }`) is typed `undefined`
  → TS2349 "not callable". Fix with a JSDoc `@param` marking the prop optional fn.
- Pass-through wrappers (`<Wrapped {...props} />`) typed `Record<string,any>` fail
  TS2740 (missing required props). Type props as
  `import('react').ComponentProps<typeof Wrapped>` instead.
- Implicit-any params (TS7006/TS7031): add JSDoc `@param` or inline
  `(/** @type {T} */ name)`. Use `(...args: any[]) => void` for callbacks whose
  call shape is uncertain to avoid cascading errors.

**Adding `@ts-check` can surface NEW errors not in the global-checkJs scan:**
narrowing a prop's JSDoc type too tightly (e.g. `loreEntry?: {importance, subject}`)
breaks other property accesses (`.keyword`, `.color_hex`); and a prop typed
`?: string` becomes `string|undefined`, breaking `.toLowerCase()`/`.substring`.
Fixes: type grab-bag entity objects as `any` (or `Record<string,any>`), default
optional string props (`content = ''`), and gate optional callbacks with `?.`.
Also: a caller passing `null` to a `?: string` prop fails — widen to `string|null`.

**Why:** keeps the typecheck validation green after each batch while actually
catching logic bugs, instead of a risky global flip.
**How to apply:** measure → enable clean files → fix single-error hotspots
(prioritize pages/hooks/chat) → re-run `pnpm --filter @workspace/anima-protocol run typecheck`.
