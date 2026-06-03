# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

**Anima Protocol** is a pnpm monorepo: React/Vite frontend (`artifacts/anima-protocol`), Express API (`artifacts/api-server`), shared Drizzle DB package (`lib/db`), and optional **Mockup Sandbox** (`artifacts/mockup-sandbox`) for isolated UI previews at `/__mockup`.

The frontend calls same-origin `/api/*` (see `animaApi.js`, `base44Client.js`). There is **no Vite dev proxy** for the API — locally you need a reverse proxy (nginx on port 3000 is preconfigured in this VM) or run on Replit where path routing handles `/` vs `/api`.

### Node.js

Replit targets **Node 24** (`.replit` → `nodejs-24`). Cloud VMs may ship `/exec-daemon/node` (v22) ahead of nvm on `PATH`. **Always prepend** nvm Node 24 before `pnpm`/`node`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export PATH="$NVM_DIR/versions/node/v24.16.0/bin:$PATH"
```

(`~/.bashrc` in this environment already sets this.)

### Package manager

Use **pnpm only** (root `preinstall` rejects npm/yarn): `pnpm install --frozen-lockfile`.

### PostgreSQL (local VM)

On a fresh Cloud VM, install and start Postgres 16 if missing:

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE USER anima WITH PASSWORD 'anima_dev' CREATEDB;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE anima_dev OWNER anima;" 2>/dev/null || true
```

Dev connection string:

- `DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev`
- Apply schema: `pnpm --filter @workspace/db run push` (requires `DATABASE_URL`; also runs from `scripts/post-merge.sh` after merges)

### Required secrets (full stack)

| Variable | Used by |
|----------|---------|
| `DATABASE_URL` | API + `db push` |
| `OPENAI_API_KEY` | API (import-time check) |
| `PORT` | API `8080`, frontend `23660`, mockup `8081` |
| `BASE_PATH` | Frontend `/`, mockup `/__mockup` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend (build/dev) |
| `CLERK_PUBLISHABLE_KEY` | API `clerkMiddleware` |
| `CLERK_SECRET_KEY` | API session verification |
| `VITE_CLERK_PROXY_URL` | Frontend (empty string in dev) |

Without valid **Clerk** keys, API routes under `/api` return Clerk errors (middleware runs before handlers). The main app also fails to load Clerk JS until real keys are configured.

Optional: `ELEVENLABS_API_KEY` for TTS routes.

### Lint / test / build

No ESLint script at repo root. Validation workflows from `.replit`:

| Task | Command |
|------|---------|
| Typecheck (all packages) | `pnpm run typecheck` |
| Unit tests (no DB/API) | `pnpm --filter @workspace/anima-protocol run test` |
| Build API | `pnpm --filter @workspace/api-server run build` |
| Build frontend | `PORT=23660 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=... pnpm --filter @workspace/anima-protocol run build` |
| Root `pnpm run build` | Also builds mockup-sandbox — needs `PORT` + `BASE_PATH` for that package |

### Running services (tmux)

Use descriptive tmux session names (`anima-api`, `anima-web`, `mockup-sandbox`). Example API:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
export OPENAI_API_KEY=sk-...
export CLERK_PUBLISHABLE_KEY=pk_test_...
export CLERK_SECRET_KEY=sk_test_...
export PORT=8080 NODE_ENV=development
pnpm --filter @workspace/api-server run dev
```

Frontend:

```bash
export PORT=23660 BASE_PATH=/
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
export VITE_CLERK_PROXY_URL=
pnpm --filter @workspace/anima-protocol run dev
```

Mockup sandbox (no Clerk):

```bash
export PORT=8081 BASE_PATH=/__mockup
pnpm --filter @workspace/mockup-sandbox run dev
```

### Local reverse proxy (nginx)

To mirror Replit routing (`/` → frontend, `/api` → API), run nginx on **3000** proxying `23660` and `8080`. On a fresh VM: `sudo apt-get install -y nginx`, add `/etc/nginx/sites-available/anima-dev` (proxy `/` → `127.0.0.1:23660`, `/api/` → `127.0.0.1:8080`), enable the site, disable `default`, then `sudo nginx -t && sudo nginx -s reload`.

Open the app at `http://127.0.0.1:3000/` only after **both** dev servers are running.

### Gotchas

- `replit.md` is partly stale (guest auth / localStorage-only entities). Runtime uses **Clerk + `/api/store` + Postgres**.
- Vite configs for frontend and mockup **require** `PORT` and `BASE_PATH` at config load time.
- API `dev` script rebuilds on each start (`build` then `start`).
- pnpm may warn about ignored build scripts for `@clerk/shared`; add to `onlyBuiltDependencies` in `pnpm-workspace.yaml` if Clerk misbehaves after install.
