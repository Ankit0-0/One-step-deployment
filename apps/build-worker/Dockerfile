# Build from the repo root: docker build -f apps/build-worker/Dockerfile -t osd/build-worker:local .
# One container per deployment. It gets Redis + write access to deployments/* and NO database credentials.
# The full (non-slim) Node image ships git, python3, make and g++, which many user builds need.
FROM node:22-bookworm AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@osd/build-worker...
RUN pnpm --filter=@osd/build-worker deploy --legacy --prod /out

FROM node:22-bookworm AS runtime
ENV NODE_ENV=production WORK_DIR=/tmp/osd-build COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Package managers for user builds, fetched at image build time rather than per deployment.
RUN corepack enable && corepack install --global pnpm@10 yarn@1.22.22
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/index.js"]
