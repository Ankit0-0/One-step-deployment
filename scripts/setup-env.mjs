#!/usr/bin/env node
// Creates local env files from the checked-in examples (never overwrites) and gives the api a
// random JWT secret. `pnpm setup:env`
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['.env.example', '.env'],
  ['packages/db/.env.example', 'packages/db/.env'],
  ['apps/api/.env.example', 'apps/api/.env'],
  ['apps/proxy/.env.example', 'apps/proxy/.env'],
  ['apps/build-worker/.env.example', 'apps/build-worker/.env'],
  ['apps/web/.env.example', 'apps/web/.env.local'],
];

for (const [example, target] of files) {
  const to = join(root, target);
  if (existsSync(to)) {
    console.log(`kept     ${target}`);
    continue;
  }
  copyFileSync(join(root, example), to);
  if (target === 'apps/api/.env') {
    const secret = randomBytes(48).toString('base64url');
    writeFileSync(to, readFileSync(to, 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`));
  }
  console.log(`created  ${target}`);
}
