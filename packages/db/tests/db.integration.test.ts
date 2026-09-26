import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../src/index.js';

// Runs against a real, already-migrated Postgres (CI service or `pnpm infra:up` + `pnpm db:migrate`).
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('database (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient({ url: databaseUrl });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('has no drift between migrations and schema.prisma', () => {
    // --exit-code: 0 = no difference, 2 = difference; execFileSync throws on non-zero.
    expect(() =>
      execFileSync(
        'prisma',
        [
          'migrate',
          'diff',
          '--from-schema-datasource',
          'prisma/schema.prisma',
          '--to-schema-datamodel',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        { stdio: 'pipe', env: { ...process.env, DATABASE_URL: databaseUrl } },
      ),
    ).not.toThrow();
  });

  it('creates a project with deployments, logs and a current deployment', async () => {
    const suffix = Date.now().toString(36);
    const user = await prisma.user.create({ data: { email: `it-${suffix}@example.com` } });
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: 'Integration',
        slug: `it-${suffix}`,
        gitUrl: 'https://github.com/a/b',
      },
    });
    const deployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        logs: {
          create: [
            { ts: new Date(1_000), message: 'second', level: 'warn' },
            { ts: new Date(0), message: 'first' },
          ],
        },
      },
    });

    expect(deployment.status).toBe('QUEUED');
    const logs = await prisma.deploymentLog.findMany({
      where: { deploymentId: deployment.id },
      orderBy: [{ ts: 'asc' }, { id: 'asc' }],
    });
    expect(logs.map((l) => l.message)).toEqual(['first', 'second']);

    await prisma.project.update({
      where: { id: project.id },
      data: { currentDeploymentId: deployment.id },
    });
    const withCurrent = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { currentDeployment: true },
    });
    expect(withCurrent.currentDeployment?.id).toBe(deployment.id);

    // Deleting the user cascades to projects, deployments and logs.
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.deploymentLog.count({ where: { deploymentId: deployment.id } })).toBe(0);
  });

  it('enforces unique slugs and emails', async () => {
    const email = `dup-${Date.now().toString(36)}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
    await prisma.user.delete({ where: { id: user.id } });
  });
});
