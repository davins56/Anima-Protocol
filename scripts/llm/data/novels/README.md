# Novel / extract drops (gitignored)

Put operator copies of the source novels here if you do not want them at
the repo root. **Never commit full novel text.**

Preferred drop locations (first matching book id wins):

1. `llm-raw-source/` — plain-text extracts (best for the curator)
2. `serenity-extract/`
3. `llm-raw/` — PDFs (`pdftotext` if poppler-utils is installed)
4. This folder
5. `scripts/llm/data/samples/novels/` — committed synthetic fixtures

Then:

```bash
pnpm llm:curate-novels
pnpm llm:dataset
```

Weights and voice rules: [`../brief/serenity-anima-design.md`](../brief/serenity-anima-design.md).
`fallen-angel` is world lore only — not Serenity voice SFT.
