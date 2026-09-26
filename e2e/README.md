# End-to-end tests

One Playwright happy path: sign in with the console email driver → create a project → deploy →
watch the live logs → reload for the persisted history. The api runs for real (built from
`apps/api/dist`) with `BUILD_RUNNER=mock`, so builds are simulated but every event still flows
through Redis, the ingestor, Postgres and socket.io.

```sh
pnpm infra:up && pnpm db:migrate
NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_ROOT_DOMAIN=localhost:8000 pnpm build
DATABASE_URL=... REDIS_URL=... S3_ACCESS_KEY_ID=osdminio S3_SECRET_ACCESS_KEY=... pnpm test:e2e
```

Ports 3000 and 4000 must be free (stop the compose `apps`/`web` profiles first). The api log is
written to `e2e/.artifacts/api.log`; traces of failed runs go to `e2e/.artifacts/results`.
Install the browser once with `pnpm --filter @osd/e2e exec playwright install chromium`.
