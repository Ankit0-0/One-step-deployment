#!/usr/bin/env node
// Fills the ${...} placeholders in infra/aws/{iam,ecs,s3}/*.json and writes infra/aws/out/.
//   AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-south-1 BUCKET=my-osd-sites ECS_CLUSTER=osd \
//   HOSTED_ZONE_ID=Z0123456789 IMAGE_TAG=v1 node infra/aws/render.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VARS = [
  'AWS_ACCOUNT_ID',
  'AWS_REGION',
  'BUCKET',
  'ECS_CLUSTER',
  'HOSTED_ZONE_ID',
  'IMAGE_TAG',
];
export const TEMPLATE_DIRS = ['iam', 'ecs', 's3'];

export function render(text, values) {
  return text.replace(/\$\{([A-Z_]+)\}/g, (match, name) => {
    if (!(name in values)) throw new Error(`unknown placeholder ${match}`);
    return values[name];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(fileURLToPath(import.meta.url));
  const missing = VARS.filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(`render.mjs: set ${missing.join(', ')}`);
    process.exit(1);
  }
  const values = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const dir of TEMPLATE_DIRS) {
    mkdirSync(join(root, 'out', dir), { recursive: true });
    for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith('.json'))) {
      const out = render(readFileSync(join(root, dir, file), 'utf8'), values);
      JSON.parse(out);
      writeFileSync(join(root, 'out', dir, file), out);
    }
  }
  console.log('Rendered to infra/aws/out/');
}
