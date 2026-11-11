# Phase 1 — Anima tiny-GPT training

From-scratch pretraining pipeline for a ~34M-parameter GPT with a 1024-token window, sized for free Colab/Kaggle GPUs (fp16 on a T4).

## Usage

1. Place raw .txt corpus files in data/raw/ (your novels and transcripts; add Project Gutenberg prose for breadth).
2. pip install tokenizers numpy torch
3. python training/phase1/data_pipeline.py
4. python training/phase1/train.py

## Notes

- The BPE tokenizer reserves <|endoftext|>, <|user|>, <|anima|> role tokens for Phase 2 SFT.
- Watch val loss: if it plateaus early, add data before growing the model.
- Checkpoints save to out/anima-tiny/ckpt.pt — the best-validation checkpoint, not the last step.
- Changing block_size or VOCAB_SIZE means re-running every phase; older checkpoints will not load.
