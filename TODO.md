# TODO — AnimaOrb (Crystalline Neural Companion)

- [x] Install postprocessing deps in `artifacts/anima-protocol`
- [x] Create `artifacts/anima-protocol/src/components/AnimaOrb.tsx`
  - [x] Faceted crystalline shell
  - [x] Inner neural web (points + line segments) with thinking mode
  - [x] Add vibe-based color temperature mapping
  - [x] Add resonanceLevel to densify/glow
  - [x] Add performanceMode: fewer particles + disable bloom
  - [x] Add bloom via @react-three/postprocessing
- [x] Integrate into `artifacts/anima-protocol/src/pages/Chat.jsx`
  - [x] Derive `isThinking` from `__thinking__` message marker
  - [x] Derive vibe/intensity/resonanceLevel from existing state
  - [x] Toggle performanceMode for mobile/tablet
- [ ] Typecheck + run dev
