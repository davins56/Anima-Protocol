# Anima Protocol pitch claim readiness

This register turns the November 2026 pitch packet into acceptance criteria. It records source evidence and local verification, not a production certification. A test using a stub model or fake storage proves the application contract, not the quality or availability of a paid provider. The working branch starts from main at `1184f1653d321bab90ea17e6d6167fc6a517ae95`.

## Claims and acceptance criteria

| Claim | Evidence in the application | Remaining acceptance evidence |
| --- | --- | --- |
| Persistent identity and memory | Identity versions, append-only events, ranked recall, chat prompt integration; memory-core tests | Save a unique fact, end the session, sign back in, and demonstrate appropriate recall. Verify applied pgvector migrations and embeddings on the deployed DB. |
| Inspectable memory ledger | Integrated read-only `/api/memory-core/:characterId/recalls`, chat memory panel, What She Remembers page; ownership, pagination, retraction and corruption tests | Deploy and demonstrate the ledger with real recalls. It reports retrieved candidates, not causal explanations or proof of final prompt inclusion. Exact recall-to-reply linkage remains separate work. |
| Distinct companions | Existing identity core, voice fingerprints, scene and speaker-isolation tests | Record the same scenario with the canonical cast; assess character consistency with a human rubric rather than claiming perfect personality fidelity. |
| Situational group scenes | Existing scene state, presence, adult gate, speaker planning and chat UI; sceneMind and situationalScenes tests | Check production `ANIMA_SITUATIONAL_SCENES` configuration and demonstrate present, absent, addressed and unheard characters with a real model. |
| Voice | Existing voice routes and runtime expression/viseme integration; voice tests and VRM runtime tests | Configure the chosen provider, test microphone permissions and audible output on iPad Safari. A stub response is not evidence of natural speech. |
| Customizable 3D vessels | Integrated signed VRM/GLB upload, authenticated loading, expressions, lip sync, Studio, chat/presence/battle/sim wiring; vessel tests | Provision private model storage and required migrations, upload a licensed model and verify rendering and voice-driven movement on device. Procedural fallback remains available. |
| Photo-to-vessel creation | Integrated on-device Face/Pose landmark lab, photo-fitted head mesh, ARKit morphs and GLB export; fitter, mesh and math tests | Experimental head generation, not complete full-body reconstruction. Enable lab assets and build flag, test likeness quality on consenting/fictional references, export GLB and upload it through Studio. Full-body reconstruction is not implemented by this branch. |
| User-commanded web search | Existing `/search` and `/web` composer commands, explicit UI controls, audited results and provider-disabled behavior; search tests | Configure a search provider and demonstrate no provider request during ordinary chat. The general tools permissions/confirmation/kill-switch schema is not an integrated general-purpose executor. Do not advertise unrestricted autonomous web tools. |
| Private character memory | Existing SEC-001 and SEC-005b regressions; owner-only ledger and memory-core route checks added here | Continue the separate audit of legacy shared facts and all retrieval paths; these suites do not certify every context path. No change to speaker-only mood/synchro behavior or Anima creation limits. |
| In-house model | Existing own-model trainer/runtime and hosted/custom provider routing; ownModel and chatBrain tests | Record actual deployed model ID, weights origin, license, training provenance and provider. The committed configuration selects Cloudflare chat. Do not imply a proprietary foundation model merely because orchestration is authored here. |
| Explorable game world | Existing cyberworld and battle systems plus vessel integration | Capture the actual playable loop, verify save/load and an authored story encounter. The planned Fallen Circuit adaptation, full game release and publisher-ready vertical slice are not proved by existing routes. |
| Commercial product | Existing billing/metering/PWA implementation is a starting point | Verify a sandbox checkout and webhook fulfillment, real provider costs, configured product IDs, return metrics and subscription economics. No users, revenue, retention, IP assignments or publication dates are manufactured by code. |

## Implementation in this branch

Recovered the existing recall-ledger and vessel work from feature branches, preserving their original authorship. Reconciled them with current chat emotion dimensions, story controls, character presentation treatments and portaled memory details. The portrait uses a snapshot instead of creating another WebGL context; the expanded view renders the model.

Added owner checks before bootstrap, event creation, identity changes and retraction work. Foreign, missing and non-companion IDs return the same 404 before memory operations. The ledger filters both user and character on recalled events and never performs an embedding call.

Added rejection of uploaded models with external image/buffer URIs and mismatched container lengths. Private model bytes and vessel records are cleared at account boundaries; late record responses cannot repopulate a new account's cache. Retained migration and secret checks.

## Validation commands

Use Node 24 and `pnpm install --frozen-lockfile`. The API test harness requires `DATABASE_URL` and creates disposable schemas. Use a dedicated local test database; no production database was used for this verification.

```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/anima-protocol run typecheck
pnpm --filter @workspace/api-server exec vitest run --config vitest.config.ts test/recallLedger.test.ts test/memoryHealthOwnership.test.ts test/vesselConfig.test.ts test/vesselModelInspect.test.ts test/vesselModelUploads.test.ts test/webSearch.test.ts test/memoryCore.test.ts test/situationalScenes.test.ts test/sceneMind.test.ts test/sec001SpeakerMemories.test.ts test/sec005bSpeakerEmotionalState.test.ts test/voice.test.ts test/sacredSpaceMemory.test.ts test/chatBrain.test.ts test/ownModel.test.ts
pnpm --filter @workspace/anima-protocol exec vitest run --config vitest.config.ts src/lib/vessel src/components/vessel src/lib/sim/vesselModel.test.ts src/lib/rendererQuality.test.js src/components/memory/MemoryHealth.test.tsx src/components/memory/RecallLedgerPanel.test.tsx src/lib/situationalScene.test.js src/hooks/useSituationalScene.test.jsx src/lib/webSearch.test.jsx src/hooks/useRecallLedger.test.ts src/lib/recallLedgerDisplay.test.ts src/lib/whatSheRemembers.test.js src/pages/WhatSheRemembers.test.jsx
pnpm check:migrations
pnpm check:secrets
pnpm run build
```

## Local verification results

On November 15, 2026, the focused backend selection passed 218 tests across 15 files, and the focused frontend selection passed 191 tests across 31 files. The full workspace typecheck passed. The normal production build and a build with `VITE_VESSEL_LAB=1` both passed, including prerendering, asset checks and static chunk-cycle checks. MediaPipe assets downloaded and passed their checksums. These are local results; no real provider call, authenticated browser session, hosted migration or deployment is certified by them.

## Deployment requirements

1. Review and apply the existing memory/vessel SQL dependencies documented in `docs/recall-ledger.md` and `docs/vessel-model-uploads.md`. The new character-model bucket migration is additive and not applied to a hosted project here. Confirm whether it already exists before applying it. Preserve production data and append-only migration history.
2. Provision the private `character-models` bucket, verify its policy and CORS behavior, and bind server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put the service key in a Vite variable. Existing deployments using another database can still require a separate storage setup.
3. For the experimental photo lab, run `node scripts/fetch-mediapipe-assets.mjs` from `artifacts/anima-protocol`. The model files are checksummed and assets stay on the application's origin. Build with `VITE_VESSEL_LAB=1` to expose `/vessel/lab`; the build fails if its local model/WASM assets are missing. Without the flag, production excludes the lab and its assets. The Studio link follows the same flag.
4. Verify actual model, voice and search configuration. Record enabled flags and provider availability without exposing secret values. Confirm licenses for weights, model assets, source images and deployed features against the exact versions used.
5. Run the demo below on the deployed build before marking a claim live. Save the deployment ID, source commit, device/browser and result.

## Demo acceptance run

Use a fresh test account with companions A and B and a second account C. Use invented facts, not real private data.

1. Tell A a unique private fact. Start another session and ask A about it. Open the ledger and inspect its timestamp and source. Retract it and verify that it disappears from future retrieval.
2. Ask B and account C about A's private fact. It must not be retrieved. Explicitly shared knowledge must carry its permitted scope. Do not infer privacy from an answer alone; inspect the recorded prompt/retrieval evidence.
3. In a group scene, move B away, send an addressed line to A, then bring B back. Inspect speaker selection, heard-by information and character-specific state. Verify stale/retried plans do not leak unheard dialogue.
4. Upload a licensed, self-contained VRM. Save a version, reload, preview emotion, play speech, then open presence and battle/sim. Check fallback behavior, GPU/context use and reduced motion on iPad.
5. In the lab, use a permitted frontal photo, check landmark overlay, build and animate the head, export GLB, and attach it through Studio. Report head-only and likeness limitations explicitly.
6. Run an explicit web search and inspect the audit entry. Send ordinary chat and verify no unsolicited search. Sign out and switch accounts; cached vessels and private ledger content must not remain accessible in the interface.
7. Verify actual subscription entitlement fulfillment and measured inference/voice costs before pitching financial sustainability.

## Work still required beyond this integration

The highest-priority follow-up is a per-reply memory provenance record written after final prompt packing, tied to the committed server turn. It must distinguish retrieved, packed, omitted and timed-out sources, including shared facts and Sacred Space. The current candidate ledger must retain its accurate wording until this exists.

General tool execution needs runtime enforcement of explicit user intent, owner-scoped permissions, confirmations, kill switches and append-only action events before any new executor is exposed. The existing schema alone is insufficient.

Full-body photo reconstruction, a complete Fallen Circuit vertical slice, production model evaluation, retention measurements, unit economics, legal entity/IP verification and publication history require additional work or external evidence. None is marked complete here.
