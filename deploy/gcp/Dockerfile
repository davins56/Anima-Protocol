# syntax=docker/dockerfile:1
# Cloud Run staging/backup image for Anima Protocol.
# Does NOT replace the Cloudflare Worker. Do not point anima-protocol.com here.
# Build from the repository root:
#   docker build -f deploy/gcp/Dockerfile \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_... \
#     -t anima-protocol-staging .
#
# Never bake secret values into this image. Clerk publishable keys are public
# client identifiers and must be passed as a build-arg (Vite inlines them).

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# Vite inlines the publishable key. Runtime secrets stay out of the image.
ARG VITE_CLERK_PUBLISHABLE_KEY=pk_test_placeholder
ARG VITE_CLERK_PROXY_URL=
ARG VITE_API_ORIGIN=
ARG BASE_PATH=/
ENV PORT=8080 \
    BASE_PATH=${BASE_PATH} \
    VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY} \
    VITE_CLERK_PROXY_URL=${VITE_CLERK_PROXY_URL} \
    VITE_API_ORIGIN=${VITE_API_ORIGIN} \
    NODE_ENV=production

RUN pnpm --filter @workspace/api-server run build \
 && PORT=8080 BASE_PATH=${BASE_PATH} pnpm --filter @workspace/anima-protocol run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    ANIMA_RUNTIME=cloudrun \
    ANIMA_LLM_PROVIDER=custom \
    ANIMA_STATIC_DIR=/app/public \
    PORT=8080
RUN groupadd --system anima && useradd --system --gid anima --home /app anima

# esbuild leaves @google-cloud/* external. Install only those runtime extras.
COPY artifacts/api-server/package.json /tmp/api-package.json
RUN node -e "\
  const fs=require('fs');\
  const src=JSON.parse(fs.readFileSync('/tmp/api-package.json','utf8'));\
  const deps=src.dependencies||{};\
  const pick=['@google-cloud/storage','google-auth-library'];\
  const out={name:'anima-cloudrun-runtime',private:true,dependencies:{}};\
  for (const n of pick) {\
    if (!deps[n]) throw new Error('missing '+n+' in api-server package.json');\
    out.dependencies[n]=deps[n];\
  }\
  fs.writeFileSync('/app/package.json', JSON.stringify(out,null,2));\
" \
 && npm install --omit=dev --no-audit --no-fund \
 && rm -rf /tmp/api-package.json /root/.npm

COPY --from=build --chown=anima:anima /workspace/artifacts/api-server/dist/cloudrun.mjs /app/dist/cloudrun.mjs
COPY --from=build --chown=anima:anima /workspace/artifacts/api-server/dist/cloudrun.mjs.map /app/dist/cloudrun.mjs.map
COPY --from=build --chown=anima:anima /workspace/artifacts/anima-protocol/dist/public /app/public
RUN chown -R anima:anima /app

USER anima
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/cloudrun.mjs"]
