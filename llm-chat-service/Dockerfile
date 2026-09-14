FROM node:24-slim AS build

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src

RUN corepack enable && pnpm install --no-frozen-lockfile --ignore-scripts && pnpm run build

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

EXPOSE 8082
CMD ["node", "dist/src/server.js"]