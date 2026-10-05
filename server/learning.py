# Anima Protocol — online learning for the steward's own model.
#
# A lesson is a correction taught in the app: the conversation so far, the
# reply that missed ("rejected"), and the reply the steward wanted
# ("chosen"). Learning a lesson fine-tunes a *copy* of the live weights:
#
#   * SFT on the chosen reply, so the model learns what to say;
#   * a DPO push away from the rejected reply (against the frozen base), so it
#     learns what not to say;
#   * a few earlier lessons replayed in every step, so a new lesson does not
#     wash out the old ones.
#
# It keeps practising until the corrected reply is no longer surprising (or
# a step cap), then swaps the copy in. Serving never waits on training and
# never sees half-updated weights. Every learned state is a numbered version
# on disk, so a bad lesson can be rolled back.
#
# The app's database is the source of truth for lessons; this store is a
# cache the app can resync (`sync`), which also relearns everything from the
# base checkpoint — how a deleted lesson is actually forgotten.

import copy
import hashlib
import json
import logging
import os
import queue
import random
import threading
import time
import uuid

import torch
import torch.nn as nn
import torch.nn.functional as F

import _paths  # noqa: F401
import modeling
import sft
from train import GPT, GPTConfig

log = logging.getLogger("anima.learning")

LESSON_LR = 2e-4
# A model that barely moves at LESSON_LR (smaller than the default config, or
# very sure of its mistake) gets its step size doubled after each slow window,
# up to this cap. A model that learns easily never escalates.
LESSON_LR_MAX = 3.2e-3
LESSON_PATIENCE = 8
# Each window must cut the loss to this fraction of where it started.
LESSON_PROGRESS = 0.7
LESSON_MIN_STEPS = 4
LESSON_MAX_STEPS = 80
# Mean nats per reply token. Below this the model all but reproduces the
# correction, so more steps would only overfit.
LESSON_TARGET_LOSS = 0.35
REPLAY_LESSONS = 3
DPO_BETA = 0.1
DPO_WEIGHT = 0.5
REBUILD_MAX_EPOCHS = 30
REBUILD_BATCH = 8
KEEP_VERSIONS = 5
MAX_LESSONS = 5000
MAX_CHOSEN_CHARS = 4000
MAX_CONTEXT_MESSAGES = 64
MAX_CONTEXT_CHARS = 8000
AFTER_REPLY_TOKENS = 96
RECENT_JOBS = 20


def _now() -> float:
    return time.time()


def file_fingerprint(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_checkpoint(path: str, device: str) -> GPT:
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    model = GPT(GPTConfig(**ckpt["cfg"]))
    model.load_state_dict(ckpt["model"])
    model.to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)
    return model


def _write_json(path: str, data) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


class LessonError(ValueError):
    """A lesson the store refuses (bad shape, too large, store full)."""


def clean_lesson(raw: dict) -> dict:
    """Validate and normalise an incoming lesson."""
    if not isinstance(raw, dict):
        raise LessonError("lesson must be an object")
    chosen = modeling.message_text(raw.get("chosen")).strip()
    if not chosen:
        raise LessonError("chosen (the better reply) is required")
    if len(chosen) > MAX_CHOSEN_CHARS:
        raise LessonError(f"chosen is longer than {MAX_CHOSEN_CHARS} characters")
    rejected = modeling.message_text(raw.get("rejected")).strip() or None
    if rejected and len(rejected) > MAX_CHOSEN_CHARS:
        rejected = rejected[:MAX_CHOSEN_CHARS]
    messages = raw.get("messages") or []
    if not isinstance(messages, list):
        raise LessonError("messages must be a list")
    context = []
    for m in modeling.normalize_messages(messages[-MAX_CONTEXT_MESSAGES:]):
        text = m["content"][-MAX_CONTEXT_CHARS:]
        context.append({"role": m["role"], "content": text})
    lesson_id = str(raw.get("id") or uuid.uuid4().hex)[:80]
    if not all(c.isalnum() or c in "-_:." for c in lesson_id):
        raise LessonError("id may only contain letters, digits, - _ : .")
    created = raw.get("created_at")
    return {
        "id": lesson_id,
        "messages": context,
        "chosen": chosen,
        "rejected": rejected,
        "created_at": float(created) if isinstance(created, (int, float)) else _now(),
    }


class LiveModel:
    """The weights being served, the frozen base, and the lesson learner."""

    def __init__(self, base_path: str, live_dir: str, device: str = "cpu", autostart: bool = True):
        self.base_path = base_path
        self.live_dir = live_dir
        self.device = device
        os.makedirs(live_dir, exist_ok=True)
        self.base_fingerprint = file_fingerprint(base_path)
        self.base = load_checkpoint(base_path, device)
        self.cfg = self.base.cfg
        self.model = self.base  # serving weights; replaced (never mutated) by learning
        self.version = 0
        self.learned: dict[str, dict] = {}
        self.history: list[dict] = []
        self.lessons: dict[str, dict] = {}
        self._max_version = 0
        self._lock = threading.RLock()
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._jobs: dict[str, dict] = {}
        self._job_order: list[str] = []
        self._current_job: str | None = None
        self._encoded: dict[str, tuple[str, modeling.LessonExample]] = {}
        self._restore()
        self._worker = None
        if autostart:
            self.start()
        stored = set(self.lessons)
        if stored and not stored & set(self.learned):
            # Fresh volume or a retrained base checkpoint: relearn what was taught.
            log.info("relearning %d stored lessons on the current base", len(stored))
            self.submit("rebuild")

    # ------------------------------------------------------------ persistence

    @property
    def _state_path(self) -> str:
        return os.path.join(self.live_dir, "state.json")

    @property
    def _lessons_path(self) -> str:
        return os.path.join(self.live_dir, "lessons.json")

    def _ckpt_path(self, version: int) -> str:
        return os.path.join(self.live_dir, f"ckpt-v{version}.pt")

    def _restore(self) -> None:
        stored = _read_json(self._lessons_path) or {}
        for lesson in stored.get("lessons", []):
            try:
                cleaned = clean_lesson(lesson)
            except LessonError:
                continue
            self.lessons[cleaned["id"]] = cleaned
        state = _read_json(self._state_path) or {}
        self._max_version = int(state.get("max_version") or 0)
        if state.get("base_fingerprint") != self.base_fingerprint:
            if state:
                log.info("base checkpoint changed; starting from the new base")
            return
        version = int(state.get("version") or 0)
        if version <= 0:
            self.history = list(state.get("history") or [])
            return
        path = self._ckpt_path(version)
        if not os.path.isfile(path):
            log.warning("live checkpoint v%d is missing; starting from base", version)
            return
        self.model = load_checkpoint(path, self.device)
        self.version = version
        self.learned = dict(state.get("learned") or {})
        self.history = list(state.get("history") or [])

    def _save_lessons(self) -> None:
        ordered = sorted(self.lessons.values(), key=lambda l: l["created_at"])
        _write_json(self._lessons_path, {"lessons": ordered})

    def _save_state(self) -> None:
        _write_json(self._state_path, {
            "base_fingerprint": self.base_fingerprint,
            "version": self.version,
            "max_version": self._max_version,
            "learned": self.learned,
            "history": self.history,
        })

    def _commit(self, model: GPT, kind: str, learned: dict[str, dict], extra: dict) -> int:
        """Save `model` as a new version and start serving it."""
        self._max_version += 1
        version = self._max_version
        tmp = self._ckpt_path(version) + ".tmp"
        torch.save({
            "model": model.state_dict(),
            "cfg": dict(model.cfg.__dict__),
            "version": version,
            "base_fingerprint": self.base_fingerprint,
        }, tmp)
        os.replace(tmp, self._ckpt_path(version))
        with self._lock:
            entry = {
                "version": version,
                "parent": self.version,
                "kind": kind,
                "created_at": _now(),
                "learned": dict(learned),
                **extra,
            }
            self.history.append(entry)
            self.model = model
            self.version = version
            self.learned = dict(learned)
            self._prune_history()
            self._save_state()
        return version

    def _prune_history(self) -> None:
        while len(self.history) > KEEP_VERSIONS:
            old = self.history.pop(0)
            if old["version"] != self.version:
                try:
                    os.remove(self._ckpt_path(old["version"]))
                except OSError:
                    pass

    # ------------------------------------------------------------ lessons

    def put_lesson(self, raw: dict) -> dict:
        lesson = clean_lesson(raw)
        with self._lock:
            if lesson["id"] not in self.lessons and len(self.lessons) >= MAX_LESSONS:
                raise LessonError(f"lesson store is full ({MAX_LESSONS})")
            previous = self.lessons.get(lesson["id"])
            if previous:
                lesson["created_at"] = previous["created_at"]
            self.lessons[lesson["id"]] = lesson
            self._save_lessons()
        return lesson

    def remove_lesson(self, lesson_id: str) -> dict:
        with self._lock:
            removed = self.lessons.pop(lesson_id, None) is not None
            if removed:
                self._save_lessons()
            return {"removed": removed, "was_learned": lesson_id in self.learned}

    def replace_lessons(self, raws: list[dict]) -> int:
        cleaned = {}
        for raw in raws[:MAX_LESSONS]:
            lesson = clean_lesson(raw)
            cleaned[lesson["id"]] = lesson
        with self._lock:
            self.lessons = cleaned
            self._save_lessons()
        return len(cleaned)

    def _example(self, lesson: dict) -> modeling.LessonExample:
        key = hashlib.sha256(json.dumps(
            [lesson["messages"], lesson["chosen"], lesson["rejected"]], sort_keys=True,
        ).encode("utf-8")).hexdigest()
        cached = self._encoded.get(lesson["id"])
        if cached and cached[0] == key:
            return cached[1]
        example = modeling.encode_lesson(
            lesson["messages"], lesson["chosen"], lesson["rejected"], self.cfg.block_size,
        )
        self._encoded[lesson["id"]] = (key, example)
        return example

    # ------------------------------------------------------------ jobs

    def start(self) -> None:
        if self._worker is None:
            self._worker = threading.Thread(target=self._run, name="anima-learner", daemon=True)
            self._worker.start()

    def submit(self, kind: str, lesson_id: str | None = None) -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._jobs[job_id] = {
                "id": job_id,
                "kind": kind,
                "lesson_id": lesson_id,
                "status": "queued",
                "created_at": _now(),
                "event": threading.Event(),
            }
            self._job_order.append(job_id)
            while len(self._job_order) > RECENT_JOBS * 5:
                self._jobs.pop(self._job_order.pop(0), None)
        self._queue.put(job_id)
        return job_id

    def job(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return self._public_job(job) if job else None

    def wait(self, job_id: str, timeout: float) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return None
        job["event"].wait(max(float(timeout), 0.0))
        return self.job(job_id)

    @staticmethod
    def _public_job(job: dict) -> dict:
        return {k: v for k, v in job.items() if k != "event"}

    def _run(self) -> None:
        while True:
            job_id = self._queue.get()
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    continue
                job["status"] = "running"
                job["started_at"] = _now()
                self._current_job = job_id
            try:
                if job["kind"] == "learn":
                    result = self._learn(job["lesson_id"])
                elif job["kind"] == "rebuild":
                    result = self._rebuild(job)
                elif job["kind"] == "rollback":
                    result = self._rollback()
                else:
                    raise ValueError(f"unknown job kind {job['kind']!r}")
                with self._lock:
                    job["status"] = "done"
                    job["result"] = result
            except Exception as exc:  # the worker must outlive any one job
                log.exception("learning job %s failed", job_id)
                with self._lock:
                    job["status"] = "failed"
                    job["error"] = str(exc)[:300]
            finally:
                with self._lock:
                    job["finished_at"] = _now()
                    self._current_job = None
                job["event"].set()

    # ------------------------------------------------------------ training

    def _learn(self, lesson_id: str) -> dict:
        with self._lock:
            lesson = self.lessons.get(lesson_id)
            if lesson is None:
                raise KeyError(f"lesson {lesson_id} was removed before it was learned")
            source = self.model
            learned = dict(self.learned)
            replay = [self.lessons[i] for i in learned if i in self.lessons and i != lesson_id]
        example = self._example(lesson)
        student, stats = learn_lesson(
            source, self.base, example, [self._example(l) for l in replay], self.device,
        )
        after_reply, _, _ = modeling.generate_text(
            student, example.prompt_ids, AFTER_REPLY_TOKENS, temperature=0.5,
        )
        learned[lesson_id] = {**stats, "at": _now()}
        version = self._commit(student, "learn", learned, {"lesson_ids": [lesson_id], **stats})
        return {"version": version, "lesson_id": lesson_id, **stats, "after_reply": after_reply.strip()}

    def _rebuild(self, job: dict) -> dict:
        with self._lock:
            lessons = sorted(self.lessons.values(), key=lambda l: l["created_at"])
        if not lessons:
            version = self._commit(copy.deepcopy(self.base), "rebuild", {}, {"lessons": 0})
            return {"version": version, "lessons": 0, "epochs": 0}

        def progress(epochs, losses):
            with self._lock:
                job["progress"] = {
                    "epoch": epochs,
                    "mean_loss": round(sum(losses) / len(losses), 4),
                    "max_loss": round(max(losses), 4),
                }

        student, losses, epochs = relearn(
            self.base, [self._example(l) for l in lessons], self.device, on_epoch=progress,
        )
        learned = {
            l["id"]: {"loss_after": round(loss, 4), "at": _now()}
            for l, loss in zip(lessons, losses)
        }
        version = self._commit(student, "rebuild", learned, {"lessons": len(lessons), "epochs": epochs})
        return {
            "version": version,
            "lessons": len(lessons),
            "epochs": epochs,
            "mean_loss": round(sum(losses) / len(losses), 4),
        }

    def _rollback(self) -> dict:
        with self._lock:
            if not self.history or self.history[-1]["version"] != self.version:
                raise LessonError("nothing to roll back")
            current = self.history[-1]
            parent = current.get("parent", 0)
            if parent == 0:
                model, learned = self.base, {}
            else:
                previous = next((h for h in self.history if h["version"] == parent), None)
                path = self._ckpt_path(parent)
                if previous is None or not os.path.isfile(path):
                    raise LessonError("the previous version is no longer kept")
                model, learned = load_checkpoint(path, self.device), dict(previous["learned"])
            self.history.pop()
            try:
                os.remove(self._ckpt_path(current["version"]))
            except OSError:
                pass
            self.model = model
            self.version = parent
            self.learned = learned
            self._save_state()
            return {"version": parent, "undid": current["version"], "kind": current["kind"]}

    # ------------------------------------------------------------ status

    def can_rollback(self) -> bool:
        with self._lock:
            if not self.history or self.history[-1]["version"] != self.version:
                return False
            parent = self.history[-1].get("parent", 0)
            return parent == 0 or any(h["version"] == parent for h in self.history)

    def status(self) -> dict:
        with self._lock:
            stored = set(self.lessons)
            learned_ids = sorted(i for i in self.learned if i in stored)
            recent = [self._public_job(self._jobs[j]) for j in self._job_order[-RECENT_JOBS:] if j in self._jobs]
            current = self._public_job(self._jobs[self._current_job]) if self._current_job in self._jobs else None
            return {
                "version": self.version,
                "base": os.path.basename(self.base_path),
                "base_fingerprint": self.base_fingerprint[:12],
                "params": sum(p.numel() for p in self.base.parameters()),
                "block_size": self.cfg.block_size,
                "device": self.device,
                "lessons_stored": len(stored),
                "lessons_learned": len(learned_ids),
                "learned_ids": learned_ids,
                # Deleted lessons the current weights still carry; a sync
                # (relearn from base) is how they are actually forgotten.
                "forgotten_pending": len(set(self.learned) - stored),
                "training": current is not None or not self._queue.empty(),
                "queue": self._queue.qsize(),
                "current_job": current,
                "recent_jobs": list(reversed(recent)),
                "can_rollback": self.can_rollback(),
            }

    def list_lessons(self) -> list[dict]:
        with self._lock:
            return [
                {"id": l["id"], "created_at": l["created_at"], "learned": l["id"] in self.learned}
                for l in sorted(self.lessons.values(), key=lambda l: l["created_at"])
            ]


# ------------------------------------------------------------------ training core
# Shared by LiveModel (server.py) and the background trainer (trainer.py).

def pad(seqs: list[list[int]], device: str) -> torch.Tensor:
    T = max(len(s) for s in seqs)
    x = torch.full((len(seqs), T), sft.eot_id, dtype=torch.long)
    for i, s in enumerate(seqs):
        x[i, :len(s)] = torch.tensor(s, dtype=torch.long)
    return x.to(device)


def _targets(x: torch.Tensor, examples) -> torch.Tensor:
    y = torch.full_like(x, -100)
    for i, e in enumerate(examples):
        y[i, :len(e.sft_targets)] = torch.tensor(e.sft_targets, dtype=torch.long)
    return y


def sft_loss(model: GPT, examples, device: str) -> torch.Tensor:
    x = pad([e.sft_ids for e in examples], device)
    logits, _ = model(x)
    return sft.masked_next_token_loss(logits, _targets(x, examples))


@torch.no_grad()
def reply_losses(model: GPT, examples, device: str) -> list[float]:
    """Mean nats per reply token for each example — how surprising the
    correction still is to the model."""
    out = []
    for i in range(0, len(examples), REBUILD_BATCH):
        chunk = examples[i:i + REBUILD_BATCH]
        x = pad([e.sft_ids for e in chunk], device)
        y = _targets(x, chunk)
        logits, _ = model(x)
        tok = F.cross_entropy(
            logits[:, :-1, :].reshape(-1, logits.size(-1)),
            y[:, 1:].reshape(-1),
            ignore_index=-100,
            reduction="none",
        ).view(len(chunk), -1)
        mask = (y[:, 1:] != -100).float()
        out.extend(((tok * mask).sum(1) / mask.sum(1).clamp(min=1)).tolist())
    return out


def logprob_sums(model: GPT, seqs, device: str) -> torch.Tensor:
    x = pad([ids for ids, _ in seqs], device)
    mask = torch.zeros_like(x, dtype=torch.bool)
    for i, (ids, start) in enumerate(seqs):
        mask[i, start:len(ids)] = True
    logits, _ = model(x)
    logprobs = F.log_softmax(logits[:, :-1], dim=-1)
    token_lp = logprobs.gather(-1, x[:, 1:].unsqueeze(-1)).squeeze(-1)
    return (token_lp * mask[:, 1:]).sum(dim=1)


def dpo_loss(model: GPT, base: GPT, examples, device: str) -> torch.Tensor | None:
    pairs = [e for e in examples if e.rejected_seq is not None]
    if not pairs:
        return None
    chosen = [e.chosen_seq for e in pairs]
    rejected = [e.rejected_seq for e in pairs]
    pi = logprob_sums(model, chosen, device) - logprob_sums(model, rejected, device)
    with torch.no_grad():
        ref = logprob_sums(base, chosen, device) - logprob_sums(base, rejected, device)
    return -F.logsigmoid(DPO_BETA * (pi - ref)).mean()


def train_step(model: GPT, base: GPT, optim, examples, device: str) -> float:
    loss = sft_loss(model, examples, device)
    dpo = dpo_loss(model, base, examples, device)
    if dpo is not None:
        loss = loss + DPO_WEIGHT * dpo
    optim.zero_grad(set_to_none=True)
    loss.backward()
    nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optim.step()
    return float(loss.item())


def escalate(optim, window_start: float, loss_now: float) -> None:
    """Double the step size when the last window made too little progress."""
    if loss_now <= window_start * LESSON_PROGRESS:
        return
    for group in optim.param_groups:
        group["lr"] = min(group["lr"] * 2, LESSON_LR_MAX)


def new_student(source: GPT):
    student = copy.deepcopy(source)
    # eval() keeps dropout off so a handful of steps is not dominated by
    # noise (the same choice phase-3 DPO makes); gradients still flow.
    student.eval()
    for p in student.parameters():
        p.requires_grad_(True)
    optim = torch.optim.AdamW(student.parameters(), lr=LESSON_LR, betas=(0.9, 0.95), weight_decay=0.0)
    return student, optim


def freeze(model: GPT) -> GPT:
    model.eval()
    for p in model.parameters():
        p.requires_grad_(False)
    return model


def learn_lesson(source: GPT, base: GPT, example, replay_pool, device: str) -> tuple[GPT, dict]:
    """Practise one correction on a copy of `source` until it sticks.

    `replay_pool` holds already-learned lessons; a few ride along in every
    step so the new lesson does not wash them out.
    """
    student, optim = new_student(source)
    loss_before = reply_losses(student, [example], device)[0]
    loss_now = window_start = loss_before
    steps = 0
    with torch.enable_grad():
        while steps < LESSON_MAX_STEPS:
            replay = random.sample(replay_pool, min(REPLAY_LESSONS, len(replay_pool)))
            train_step(student, base, optim, [example, *replay], device)
            steps += 1
            if steps >= LESSON_MIN_STEPS:
                loss_now = reply_losses(student, [example], device)[0]
                if loss_now <= LESSON_TARGET_LOSS:
                    break
            if steps % LESSON_PATIENCE == 0:
                escalate(optim, window_start, loss_now)
                window_start = loss_now
    freeze(student)
    loss_after = reply_losses(student, [example], device)[0]
    return student, {
        "loss_before": round(loss_before, 4),
        "loss_after": round(loss_after, 4),
        "steps": steps,
    }


def relearn(base: GPT, examples, device: str, on_epoch=None, deadline: float | None = None):
    """Learn every example from the base weights (how deleted lessons are
    forgotten). Returns (student, per-example losses, epochs)."""
    student, optim = new_student(base)
    epochs = 0
    losses = reply_losses(student, examples, device)
    window_start = sum(losses) / len(losses)
    batches = -(-len(examples) // REBUILD_BATCH)  # optimizer steps per epoch
    window = max(1, -(-LESSON_PATIENCE // batches))  # epochs per progress check
    # A handful of lessons is one step per epoch; give them the practice a
    # single lesson would get.
    max_epochs = max(REBUILD_MAX_EPOCHS, -(-LESSON_MAX_STEPS // batches))
    with torch.enable_grad():
        while epochs < max_epochs and max(losses) > LESSON_TARGET_LOSS:
            if deadline is not None and epochs > 0 and time.monotonic() > deadline:
                break
            order = list(range(len(examples)))
            random.shuffle(order)
            for i in range(0, len(order), REBUILD_BATCH):
                train_step(student, base, optim, [examples[j] for j in order[i:i + REBUILD_BATCH]], device)
            epochs += 1
            losses = reply_losses(student, examples, device)
            mean_loss = sum(losses) / len(losses)
            if epochs % window == 0:
                escalate(optim, window_start, mean_loss)
                window_start = mean_loss
            if on_epoch:
                on_epoch(epochs, losses)
    freeze(student)
    return student, losses, epochs
