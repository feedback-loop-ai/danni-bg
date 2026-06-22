# syntax=docker/dockerfile:1
# App image for danni (spec 030, FR-134): build the SPA, then run explorer-api (Bun) serving the built
# SPA + the API from one container. Bun runs the TypeScript server directly — no server transpile step.

# --- build: install deps + build the SPA bundle ---
FROM oven/bun:1.3.6 AS build
WORKDIR /app
# Copy the whole repo (workspaces need every package.json present for a faithful install), then install
# against the committed lockfile for reproducibility and build the SPA into apps/explorer-web/dist.
COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/explorer-web && bun run build

# --- runtime: slim image with deps + source + built SPA + migrations ---
FROM oven/bun:1.3.6-slim AS runtime
ENV NODE_ENV=production \
    DANNI_PROFILE=production \
    DANNI_STORE_ROOT=/data \
    EXPLORER_API_PORT=8790
WORKDIR /app
COPY --from=build /app /app
# The SQLite store (read substrate + app tables) lives on a mounted volume; migrations run on start.
VOLUME ["/data"]
EXPOSE 8790
# Migrate-on-release then serve (FR-135): a bad/pending migration fails the start, never serves 500s.
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
