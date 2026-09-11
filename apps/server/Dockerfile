# Game server image. Build context = repository root (see fly.toml):
#   fly deploy            (or: docker build -f apps/server/Dockerfile .)

FROM node:22-slim AS build
WORKDIR /app
# Workspace manifests first, so npm install is cached until dependencies change.
COPY package.json package-lock.json tsconfig.base.json game.config.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm install --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @skillergo/server

# The bundle contains everything (shared code, ws): the runtime image needs no node_modules.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=build /app/apps/server/dist/server.cjs ./server.cjs
EXPOSE 8080
CMD ["node", "server.cjs"]
