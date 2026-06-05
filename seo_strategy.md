# SEO Strategy

## In scope
- Public landing and marketing experience at `/` and `/landing`
- Public authentication entry points at `/sign-in/*` and `/sign-up/*`
- Public legal/shareable pages at `/terms`, `/privacy-policy`, and `/disclaimer`
- Static crawl assets in `artifacts/anima-protocol/public/` such as `robots.txt`, `sitemap.xml`, icons, manifest, and any SEO-relevant static HTML files

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
- `/` is the preferred homepage URL. Alternate aliases such as `/landing` and `/login` should not be promoted in sitemaps or user-facing navigation.
- Any standalone HTML file placed in `artifacts/anima-protocol/public/` is treated as a first-class crawlable URL and should either join the canonical route/metadata flow or be removed/noindexed.
