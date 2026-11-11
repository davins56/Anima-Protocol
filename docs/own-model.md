# Your own model, always on — inside the app

The tiny GPT you trained from scratch (`training/` phases 1–3) lives inside the
app. Nothing has to stay open for it: no Codespace, no model server.

| Piece | Where | What it does |
|-------|-------|--------------|
| The model | Postgres (`own_model_blobs`), served by `/api/model/*` | Each browser downloads the current version once (about 14 MB for the 13M model), keeps it on the device, and writes replies there in a Web Worker (`artifacts/anima-protocol/src/lib/ownModel/`) |
| Lessons | Postgres (`__anima_model__` partition), `/api/tutor/*` | Your corrections (**Teach** under a reply) and, with **Always learning** on, automatic ones |
| The trainer | `server/trainer.py`, run by `.github/workflows/own-model-trainer.yml` every 15 minutes | Learns the waiting lessons and publishes the next version. Browsers pick it up on their next chat |

The API only records the reply the browser wrote, then saves the turn,
memories and relationship state like any other chat turn.

## Turning it on (once)

1. **Export your model** where you trained it:

   ```bash
   python server/export_web.py --ckpt out/anima-dpo/ckpt.pt --tokens data/anima_tokens --out anima-model.bin
   ```

2. **Upload it:** Settings → Model Tutor → **Upload model**. It goes up in
   512 KB pieces, and nothing is served until every byte has arrived.
3. **Give the trainer the database:** in GitHub → Settings → Secrets and
   variables → Actions, add a repository secret **`DATABASE_URL`**. Use the same
   Postgres URL the app uses (the origin URL, not a Hyperdrive one). Without it,
   the workflow just leaves a notice and exits.
4. **Flip the switches** in Settings → Model Tutor:
   - **Answer my chats with my model** — just you, to try it first.
   - **Answer everyone's chats** — every account chats with your model instead
     of Anima. Turn it off to hand everyone back.
   - **Always learning** — see below.
   - **Also learn from people who opt in** — off by default. People opt in
     under Settings → AI Behavior → *Help Anima's own model learn*.

Optional: set **`GITHUB_TRAINER_TOKEN`** on the API host (Cloudflare secret or
Vercel env). Use a fine-grained token with *Actions: read and write* on this
repository. The API then starts the trainer right after a lesson (at most once
a minute) instead of waiting up to 15 minutes, and **Learn now** works.
`GITHUB_TRAINER_REPO` / `GITHUB_TRAINER_REF` override `davins56/Anima-Protocol`
/ `main`.

GitHub only runs scheduled workflows from the default branch, and pauses them
after 60 days without activity in the repository. Re-enable the workflow under
the Actions tab if that happens.

## How it learns from its mistakes

1. **You correct a reply.** Tap **Teach** under any assistant reply. Write what
   it should have said (and, optionally, what went wrong), or let **Draft with
   Anima** write it from your note and standing advice.
2. **Always learning** does the same without you: after each own-model reply,
   the main Anima model writes the reply it would have given to that same
   conversation, and that becomes an automatic lesson. It never learns from:
   - therapy sessions, adult scenes, or "continue" turns;
   - anyone but you, unless you allow people who opt in and they did.
3. **The trainer practises**, your lessons first. Each lesson gets:
   - SFT on the better reply, so it learns what to say;
   - a DPO push away from the reply it gave, so it learns what not to say;
   - earlier lessons replayed, so new ones don't wash out old ones.

   It stops once the reply is no longer surprising (about 0.35 nats per token,
   roughly 70% per word). That is "learned", not memorised word for word. A
   lesson that fails is retried up to 3 times.
4. **A new version is published.** Chats in progress keep the version they
   loaded. The next chat downloads the new one.

Deleting a learned lesson can't be undone inside the weights, so the next run
**relearns every remaining lesson from the base model**. That's how a lesson is
actually forgotten. **Relearn everything** does the same on demand. Only the
base and the current version are stored (about 80 MB for the 13M model).

Uploading a new base model (after retraining offline) queues every learned
lesson to be learned again on top of it.

### Advice

Standing advice ("ask what happened before giving advice") lives in Settings →
Model Tutor. The model is too small to follow written instructions, so advice
never goes into its prompt. Anima uses it whenever it writes replies for your
model to learn: your drafts and the automatic lessons alike.

### Folding lessons into the next base model

Settings → Model Tutor → **Download for retraining** saves
`steward_lessons.jsonl` (→ `data/sft/`) and `steward_preferences.jsonl`
(→ `data/prefs/`). Phases 2 and 3 read both. Export and upload the retrained
model as above.

## Privacy

- Weights are served only to signed-in accounts the model answers.
- Automatic lessons store the recent conversation, the own model's reply and
  Anima's reply. You can read them in Settings → Model Tutor, so the consent
  text says so.
- This repository is public, so its Actions logs are too. The trainer logs
  counts and losses only, never lesson text. Keep it that way if you change it.

## What to expect

- It's a ~13M-parameter model with a **256-token memory**. It sees only the
  last few turns of a chat, not the character sheet or memories the big model
  gets.
- It writes about 20–60 tokens a second on a phone or laptop.
- It learns a lesson in about 10–15 s of CPU on the trainer.
- It won't be a fluent companion until it has been trained on much more data.

If the model can't run on a device (very old browser, download blocked), that
chat falls back to Anima and says so.

## Running it by hand

`server/trainer.py` works anywhere with `DATABASE_URL` and
`pip install -r server/requirements-trainer.txt`:

```bash
python server/trainer.py --check           # anything to learn?
python server/trainer.py                   # one learning run
python server/trainer.py --watch           # keep learning as lessons arrive
python server/trainer.py --upload anima-model.bin   # same as the Upload button
```

`server/server.py` is still an OpenAI-compatible server for experimenting
with a checkpoint locally. The app no longer uses it.
