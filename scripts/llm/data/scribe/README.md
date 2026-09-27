# Scribe-register dataset (committed, synthetic)

Synthetic fine-tuning data for the **literary scribe** voice: finished,
literate replies in Serenity's and Fallen Angel's voices, written against
the rules in [`../brief/serenity-anima-design.md`](../brief/serenity-anima-design.md)
and the scribe prose rules (90–260 words, flowing paragraphs, every thought
finished, no fragments, no trailing ellipses, no assistant meta-talk).

Unlike `../raw/`, this folder **is** committed: nothing here is personal
data. It exists to cure one failure — replies that stop mid-clause, stack
fragments, or drift off the question — so the register is represented by
hundreds of examples rather than the handful of `register:scribe` seed turns.

```
sft/*.jsonl   TrainingExample rows  → merged by prepare-finetune (unless --no-scribe)
dpo/*.jsonl   {system, prompt, chosen, rejected, rejectionReason, tags}
              → appended by prepare-dpo (unless --no-scribe)
```

Each DPO `rejected` reply is one realistic failure mode, named in `tags`:
`truncation`, `fragments`, `drift`, `list-dump`, `generic-assistant`,
`restart-loop`.

Validate after editing:

```bash
python3 scripts/llm/data/scribe/validate.py
```

Your own logs in `raw/` should stay the majority of the SFT mix if you want
the voice to remain yours; the scribe rows carry weight 1 (no replicas) for
that reason. Pass `--no-scribe` to `prepare-finetune` / `prepare-dpo` /
`dataset` to train without them.
