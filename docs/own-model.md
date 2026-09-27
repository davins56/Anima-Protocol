# Your own model in the app — chat with it, teach it

The tiny GPT you trained from scratch (`training/` phases 1–3) can answer your
chats in the app and learn from you while it does. Two pieces make that work:

| Piece | Where | What it does |
|-------|-------|--------------|
| Model server | `server/server.py` (+ `modeling.py`, `learning.py`) | OpenAI-compatible chat, streaming or not, and lesson endpoints that fine-tune the live weights |
| Model Tutor | api-server `/api/tutor/*`, Settings → Model Tutor, **Teach** under chat replies | Routes your chats to your model, stores lessons and advice, and sends lessons to the model server |

Only the **steward** (the emails in `PROTOCOL_UPGRADE_ADMIN_EMAILS`, or user
ids in `PROTOCOL_UPGRADE_ADMIN_USER_IDS`) can teach it or route chats to it.
Everyone else keeps talking to the Anima LLM (`anima-chat`). Lessons change the
model's weights, so letting any account teach it would let any account poison
it.

The **Teach** button and the Model Tutor settings only appear for accounts the
app already treats as admins: your two emails, plus any listed in
`VITE_ADMIN_EMAILS`. That spares everyone else a steward lookup. If you add a
steward to `PROTOCOL_UPGRADE_ADMIN_EMAILS`, add them to `VITE_ADMIN_EMAILS` too.

## How it learns from its mistakes

1. **You correct a reply.** Tap **Teach** under any assistant reply. Write what
   it should have said (and, optionally, what went wrong).
2. **It practises.** The server copies the live weights and fine-tunes the copy:
   - SFT on your reply, so it learns what to say;
   - a DPO push away from the reply you corrected, measured against the frozen
     base, so it learns what *not* to say;
   - a few earlier lessons replayed in every step, so new lessons don't wash
     out old ones.

   It keeps going until your reply is no longer surprising (about 0.35 nats per
   token), capped at 80 steps. If progress stalls, it doubles its step size
   (up to 16×), so a smaller model still gets there.
3. **It swaps in the new weights.** Chat never sees half-trained weights. The
   dialog shows how likely it found your reply before and after, and what it
   now says when asked the same thing.
4. **Every learned state is a version.** The last 5 are kept on disk:
   - **Undo last lesson** rolls back one.
   - **Deleting** a lesson removes it from the store. Because the weights still
     carry it, **Re-teach all lessons** relearns everything that remains from
     the base checkpoint. That's how a lesson is actually forgotten.

Re-teaching the same reply refines its lesson instead of adding a conflicting
second one.

### Advice

**Standing advice** ("ask what happened before giving advice") lives in Settings
→ Model Tutor. A model this size cannot follow written instructions, so advice is
not pasted into its prompt. Instead, **Draft with Anima** in the Teach dialog asks
the main Anima model to rewrite the reply using your note plus your standing
advice. You edit the draft, and teaching it is how the advice reaches your
model's weights.

### Folding lessons into the next base model

Settings → Model Tutor → **Download for retraining** saves:

- `steward_lessons.jsonl` → put it in `data/sft/`;
- `steward_preferences.jsonl` → put it in `data/prefs/`.

Phase 2 (`sft.py`) and phase 3 (`dpo.py`) read both files automatically. After a
retrain and redeploy, the server notices the new base checkpoint and relearns
every stored lesson on top of it.

## What to expect

This is a ~13M-parameter model with a **256-token memory**. It sees only the
last few turns of a chat, not the character sheet or memories the big model
gets. It learns taught replies quickly (about 10–30 s per lesson on 2–4 CPU
cores), but it won't be a fluent companion until it has been trained on much
more data. Chats sent to it use a cooler temperature (0.6) so taught replies
show up reliably.

If the model server is down while your chats are routed to it, the chat shows
an error naming the problem. It fails closed, like the custom Anima LLM: it
never switches to another model silently. Turn the switch off in Settings →
Model Tutor to go back to Anima.

## Run it locally

```bash
pip install -r server/requirements.txt
python server/server.py                 # 127.0.0.1:8000, no token needed locally
```

It serves `out/anima-dpo/ckpt.pt` with the tokenizer in `data/anima_tokens/`.
Override with `ANIMA_CKPT` / `ANIMA_TOK_DIR`. Learned versions and the lesson
store go to `out/anima-live/` (`ANIMA_LIVE_DIR`).

Point a local api-server at it (`.env`):

```bash
ANIMA_OWN_LLM_BASE_URL=http://127.0.0.1:8000/v1
```

Then sign in as the steward, open Settings → **Model Tutor**, and switch on
**Answer my chats with my model**.

## Deploy it (Fly.io)

See `deploy/own-model-fly/README.md`. It builds an image with your trained
checkpoint and tokenizer, keeps learned versions on a volume, and requires a
bearer token.

## Connect production

The api-server needs two values. The Worker can't reach `localhost`, so the URL
must be public HTTPS.

| Variable | Value |
|----------|-------|
| `ANIMA_OWN_LLM_BASE_URL` | `https://<your-app>.fly.dev/v1` |
| `ANIMA_OWN_LLM_API_KEY` | the model server's `ANIMA_SERVER_TOKEN` |
| `ANIMA_OWN_LLM_MODEL` | optional; defaults to `anima-own` |

- **Cloudflare Worker (anima-protocol.com):** add them as classic Worker secrets,
  the same way `MINIMAX_API_KEY` is set:
  ```bash
  npx wrangler secret put ANIMA_OWN_LLM_BASE_URL --name anima-protocol
  npx wrangler secret put ANIMA_OWN_LLM_API_KEY --name anima-protocol
  ```
  Do **not** add them to `wrangler.jsonc` `secrets_store_secrets` unless you
  first create those `secret_name`s in the Secrets Store. A binding to a missing
  secret fails `wrangler deploy` and takes the site down.
- **Vercel / Node:** set them as environment variables and redeploy.

## Endpoints

Model server (all `/v1/*` routes require `Authorization: Bearer
<ANIMA_SERVER_TOKEN>` when a token is set):

| Route | Purpose |
|-------|---------|
| `POST /v1/chat/completions` | OpenAI-compatible chat; `stream: true` for SSE |
| `GET /v1/models` | Reports `anima-own` |
| `POST /v1/lessons` | Store a lesson and learn it (`wait` seconds, then 202 plus a job to poll) |
| `GET /v1/lessons/jobs/{id}` | A learning job's state and result |
| `GET /v1/lessons/status` | Version, lessons learned, training state |
| `GET /v1/lessons` · `DELETE /v1/lessons/{id}` | List or remove stored lessons |
| `POST /v1/lessons/sync` | Replace the store with the app's lessons and relearn from the base |
| `POST /v1/lessons/rollback` | Undo the latest version |
| `GET /health` | Public liveness check |

App API (Clerk session; steward-only except `status`): `GET /api/tutor/status`,
`PUT /api/tutor/preferences`, `GET|POST /api/tutor/lessons`,
`DELETE /api/tutor/lessons/:id`, `POST /api/tutor/lessons/draft`,
`GET /api/tutor/jobs/:jobId`, `POST /api/tutor/sync`, `POST /api/tutor/rollback`,
`GET|POST /api/tutor/advice`, `DELETE /api/tutor/advice/:id`,
`GET /api/tutor/export?format=sft|dpo`.

Lessons and advice are stored in Postgres in a reserved `user_entities`
partition (`__anima_model__`). No client can reach it through `/api/store`, and
no schema change is needed.

## Tests

```bash
pip install -r server/requirements-test.txt
python -m unittest discover -s server/tests -v        # model server + learning
pnpm --filter @workspace/api-server exec vitest run test/ownModel.test.ts test/modelTutorRoute.test.ts
pnpm --filter @workspace/anima-protocol exec vitest run src/components/tutor src/lib/modelTutor.test.js
```
