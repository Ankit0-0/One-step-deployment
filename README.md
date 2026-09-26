# One-step deployment

> **Rewrite in progress.** The repo is moving to a TypeScript monorepo (pnpm + turborepo).
> Phases 1–3 are in place (shared packages, local infra, CI, the api, build-worker and proxy, and
> the web dashboard); monitoring, e2e tests and the AWS setup land in Phase 4.
> The legacy folders (`api-server`, `build-server`, `s3-reverse-proxy`, `frontend-nextjs`) are kept
> for reference until Phase 4. The full README (architecture, env reference, AWS guide) comes in Phase 4.

```
apps/        api (REST + socket.io), build-worker (Docker image), proxy (subdomain → storage), web (Next.js)
packages/    config (zod env loading), shared (DTOs, events, logger, http helpers), db (Prisma),
             storage (S3/MinIO), tsconfig, eslint-config
infra/       docker-compose.yml (postgres, redis, minio)
```

### Local setup (Node 22, pnpm 10, Docker)

```sh
pnpm install
cp .env.example .env && cp packages/db/.env.example packages/db/.env
pnpm infra:up
pnpm db:migrate && pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Run the services locally (api on :4000, proxy on :8000, sites at `http://{slug}.localhost:8000`):

```sh
cp apps/api/.env.example apps/api/.env && cp apps/proxy/.env.example apps/proxy/.env
docker compose --env-file .env -f infra/docker-compose.yml --profile build build build-worker
docker compose --env-file .env -f infra/docker-compose.yml --profile apps up -d --build
```

Then the dashboard on :3000, either in compose or with hot reload:

```sh
docker compose --env-file .env -f infra/docker-compose.yml --profile web up -d --build
# or: cp apps/web/.env.example apps/web/.env.local && pnpm --filter @osd/web dev
```

With `EMAIL_DRIVER=console`, login codes are printed in the api log (`docker compose ... logs api`).

---

## Legacy: Vercel Clone

YouTube Video Link: https://youtu.be/0A_JpLYG7hM

Whiteboard Diagram: https://app.eraser.io/workspace/0f8XnDF61iGcatypPqIR?origin=share

### Prerequisite

- Node.JS: [Master NodeJS Playlist](https://youtube.com/playlist?list=PLinedj3B30sDby4Al-i13hQJGQoRQDfPo&si=5gaDmQ_mzuBHvAsg)
- Redis: [Redis Crash Course](https://youtu.be/Vx2zPMPvmug?si=Z_XT6BMNgkgwnX49)
- Learn Docker:
  - Part 1: [Docker in One Shot - Part 1](https://youtu.be/31k6AtW-b3Y?si=FIPffAKieiBGgo5c)
  - Part 2: [Docker in One Shot - Part 2](https://youtu.be/xPT8mXa-sJg?si=-6z_HkJZXsvrvSpO)
- Docker with AWS ECS and ECR: [Real World Docker Deployments with AWS](https://youtu.be/AiiFbsAlLaI?si=dKrFZFr7fLBXKSab)

### Setup Guide

This Project contains following services and folders:

- `api-server`: HTTP API Server for REST API's
- `build-server`: Docker Image code which clones, builds and pushes the build to S3
- `s3-reverse-proxy`: Reverse Proxy the subdomains and domains to s3 bucket static assets

### Local Setup

1. Run `npm install` in all the 3 services i.e. `api-server`, `build-server` and `s3-reverse-proxy`
2. Docker build the `build-server` and push the image to AWS ECR.
3. Setup the `api-server` by providing all the required config such as TASK ARN and CLUSTER arn.
4. Run `node index.js` in `api-server` and `s3-reverse-proxy`

At this point following services would be up and running:

| S.No | Service            | PORT    |
| ---- | ------------------ | ------- |
| 1    | `api-server`       | `:9000` |
| 2    | `socket.io-server` | `:9002` |
| 3    | `s3-reverse-proxy` | `:8000` |

### Architecture

![Vercel Clone Architecture](https://i.imgur.com/r7QUXqZ.png)
