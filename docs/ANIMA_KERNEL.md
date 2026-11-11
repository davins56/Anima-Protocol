# Anima Kernel

Design lives next to the other companion docs:

**[artifacts/anima-protocol/docs/ANIMA_KERNEL.md](../artifacts/anima-protocol/docs/ANIMA_KERNEL.md)**

Operator Model v1 (Hub DNA analogue) is implemented in this same change set: `user_profiles.data.operator_model`, `GET`/`PUT` `/api/operator-model`, bounded injection in `promptBuilder`.

Roadmap kill switches (Self Model, Relationship Model, Reflection, Drive, Agency, Kernel) all default off. Check `isKernelFeatureEnabled` in `artifacts/api-server/src/lib/kernelFeatures.ts` before running one. See §10 of the design doc.
