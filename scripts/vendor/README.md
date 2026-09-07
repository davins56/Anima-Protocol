# Optional vendor checkouts

`pnpm build` (Cloudflare Worker + SPA) does not import `vendor/airi` or
`external/airi`. Codespace / RepoCodespace also have no workspace or
package.json references to those paths.

Do **not** add them as git submodules. Workers Builds always runs
`git submodule update` during Cloning; unused or unmapped gitlinks fail
the deploy before Installing/Building starts.

To fetch [moeru-ai/airi](https://github.com/moeru-ai/airi) locally
(HTTPS, public):

```bash
bash scripts/vendor/clone-airi.sh
# or: bash scripts/vendor/clone-airi.sh /path/to/dest
# pin: AIRI_REF=<commit> bash scripts/vendor/clone-airi.sh
```

The default destination is gitignored.
