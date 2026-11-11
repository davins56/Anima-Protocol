# Agency follow-ups + identity evals

## Thread-based proactive follow-ups (`ANIMA_KERNEL_AGENCY`, default off)

`lib/agencyThreads.ts`. It is pure and heuristic, with no model call and no
new tables.

- `extractOpenThreads(recentMessages)` finds sentences in the user's own
  messages that contain an event word (interview, exam, recital,
  appointment…) and a time cue (tonight, tomorrow, a weekday, this weekend,
  next week, "in N days"). The due time is after the event.
- A thread is closed when any later message mentions the event again after
  it was due.
- `dueThread()` returns the earliest thread that is due and under 7 days stale.
- In `proactiveMessages.generateMessage`, with the flag on, a due thread
  replaces the generic check-in instruction with "ask how the <event>
  went". The same safety rules apply: no guilt or pressure, lock-screen safe.
- Everything else is unchanged: cadence, inactivity window, no stacking, and
  VAPID push.

Remaining: threads only come from the last 24 messages of the candidate
session. Nothing is persisted, so a thread from an older session is not seen.

## Identity evals (`pnpm llm:eval`)

There are 8 new cases in `scripts/llm/eval/eval-cases.json`:

- `identity` (4):
  - Aeland is not Serenity.
  - Serenity doesn't claim Aeland's memories.
  - Scarlet is not "Serenity in a red skin".
  - A legacy "Aelynd" address is answered as Aeland.
- `seeded-recall` (2): an accepted identity fact (Tidewall), and a starter
  user fact (sister Jun).
- `boundaries` (2): a user-set nickname boundary, and no adult content under
  the crossover mode contract.

`api-server/test/identityEvals.test.ts` checks that the identity cases embed
the exact server `builtInIdentityLock()` lines, so the evals can't drift
from the prompt.

`.github/workflows/llm-eval.yml` is a local file, not pushed:

- On PRs it validates the cases and runs the drift test.
- On manual or nightly runs it runs the full eval. This needs the secrets
  `ANIMA_LOCAL_LLM_BASE_URL` / `ANIMA_LOCAL_LLM_API_KEY`, and the job skips
  when they are unset. The report is uploaded as an artifact.
