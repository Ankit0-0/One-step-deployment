import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import {
  BucketAlreadyExists,
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { apiEnv, apiLogFile, apiUrl, artifactsDir, repoRoot } from './env.js';

async function ensureBucket(env: Record<string, string>) {
  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: env.STORAGE_BUCKET }));
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou || err instanceof BucketAlreadyExists)) throw err;
  }
}

async function waitForReady(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `${res.status} ${await res.text()}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`api not ready at ${url}: ${last} (log: ${apiLogFile})`);
}

/**
 * Starts the built api (apps/api/dist) with its output captured to a file, so tests can read the
 * login code the console email driver prints. The web app is started by Playwright's webServer.
 */
export default async function globalSetup() {
  const env = apiEnv();
  await ensureBucket(env);
  mkdirSync(artifactsDir, { recursive: true });
  const log = createWriteStream(apiLogFile);
  const api = spawn(process.execPath, ['apps/api/dist/index.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.pipe(log);
  api.stderr.pipe(log);
  const exited = new Promise<never>((_, reject) =>
    api.once('exit', (code) => reject(new Error(`api exited early (${code}); see ${apiLogFile}`))),
  );
  await Promise.race([waitForReady(`${apiUrl}/readyz`, 30_000), exited]);
  exited.catch(() => {});

  return () => {
    api.kill('SIGTERM');
  };
}
