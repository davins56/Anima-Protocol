# SEO Strategy

## In scope
- Public landing experience at `/`
- Public authentication entry points at `/sign-in/*` and `/sign-up/*`
- Public legal/shareable pages at `/terms`, `/privacy-policy`, and `/disclaimer`
- Static crawl assets in `artifacts/anima-protocol/public/` such as `robots.txt`, `sitemap.xml`, icons, manifest, `llms.txt`, and any SEO-relevant standalone documents

## Out of scope
- Authenticated application routes and dashboards (all non-public routes in `artifacts/anima-protocol/src/App.full.jsx`)
- Internal API routes under `/api/**`

## Target audience
- People looking for an AI companion or interactive storytelling product
- Existing users trying to sign in or review legal/privacy information

## Primary keywords
- AI companion
- emotionally intelligent AI companion
- AI storytelling app
- persistent memory AI companion

## Dismissed categories
- (None yet)

## Notes from scans
- Build-time prerendering in `artifacts/anima-protocol/scripts/prerender.mjs` is part of the intended SEO strategy for the public marketing, auth, and legal routes.
- `/` is the only intended canonical homepage URL. `/landing` and `/login` should be treated as legacy aliases that redirect to `/`, not as independent indexable pages.
- Any standalone file placed in `artifacts/anima-protocol/public/` is treated as a first-class public URL and should either join the canonical route/metadata/sitemap flow or be removed or noindexed.
