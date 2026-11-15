# Photo-to-vessel (experiment 1)

In-house, on-device pipeline that turns one locked frontal photo into a rigged-face GLB for the
`config.model.kind = "gltf"` vessel slot. No outside avatar providers; the photo never leaves the tab.

## Run the lab

```bash
node scripts/fetch-mediapipe-assets.mjs   # once: copies the WASM, downloads + checksums the .task models into public/mediapipe/ (gitignored)
pnpm dev                                  # then open /vessel/lab
```

`/vessel/lab` only exists in `vite dev` (or a build with `VITE_VESSEL_LAB=1`); production builds compile it out
and drop `public/mediapipe/`.

1. Pick a frontal photo (fictional or consenting likeness only).
2. Face Landmarker (478 points, 52 ARKit blendshapes) + Pose Landmarker (33 points) run on-device and are overlaid.
3. **Build head** fits `lib/vessel/photoFit` → GLB (blob URL) → Vessel Studio canvas (`VesselCanvas focus="head"`).
   Pose buttons pin morphs (blink / jaw / smile); idle runs the blink loop; talk drives `jawOpen` from speech openness.

## Pieces

| File | What |
| --- | --- |
| `src/lib/vessel/photoFit/landmarker.ts` | Lazy MediaPipe tasks-vision loader, local asset paths only |
| `src/lib/vessel/photoFit/headFit.ts` | Pure fitter: landmarks → pose-removed face mesh (canonical topology), frontal UV projection, procedural cranium, mouth cavity, ARKit morph deltas |
| `src/lib/vessel/photoFit/headMesh.ts` | three.js mesh + photo texture + cranium vertex colours, GLB export |
| `src/lib/vessel/photoFit/faceTopology.data.ts` | MediaPipe canonical face model (Apache 2.0), generated |
| `src/lib/vessel/arkitFace.ts`, `components/vessel/useArkitFace.ts` | Drives ARKit morphs on any plain GLB vessel (blink loop, smile from Expression, jaw from speech) |

## Licensing

MediaPipe tasks-vision, its models and the canonical face mesh: Apache 2.0. Everything else is authored here.
Not used (non-commercial or restrictive): FLAME, SMPL-X, DECA, EMOCA, MICA, MB-Lab, TRELLIS nvdiffrast/nvdiffrec, Hunyuan3D.
