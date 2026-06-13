# TODO - Uncensored Mode /raw implementation

- [ ] Update `artifacts/api-server/src/lib/promptBuilder.ts` to accept `uncensoredMode` and include a tone/style override while preserving the highest-priority loyalty guardrail.
- [ ] Update `artifacts/api-server/src/routes/chat.ts` to detect `/raw` and `/reset` in the incoming user message, set `uncensoredMode`, and strip the command tokens from the content passed to the prompt.
- [ ] Add unit tests under `artifacts/api-server/test/` for prompt assembly with uncensoredMode.
- [ ] (Optional) Update client message handling (if it strips commands) in `artifacts/anima-protocol/src/lib/*chat*`.
- [ ] Run api-server tests.

