/* eslint-disable no-console */
import { createPrismaClient } from '../src/index.js';

// Idempotent local seed: one user, one project, one finished deployment with logs.
const prisma = createPrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: { email: 'demo@example.com' },
  });

  const project = await prisma.project.upsert({
    where: { slug: 'demo-site' },
    update: {},
    create: {
      userId: user.id,
      name: 'Demo site',
      slug: 'demo-site',
      gitUrl: 'https://github.com/vercel/next-learn',
    },
  });

  const existing = await prisma.deployment.count({ where: { projectId: project.id } });
  if (existing === 0) {
    const startedAt = new Date(Date.now() - 90_000);
    const finishedAt = new Date(startedAt.getTime() + 42_000);
    const deployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        status: 'READY',
        commitSha: '0000000000000000000000000000000000000000',
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        logs: {
          create: [
            { ts: startedAt, level: 'info', message: 'Cloning repository' },
            {
              ts: new Date(startedAt.getTime() + 5_000),
              level: 'info',
              message: 'Installing dependencies',
            },
            {
              ts: new Date(startedAt.getTime() + 30_000),
              level: 'info',
              message: 'Build completed',
            },
            { ts: finishedAt, level: 'info', message: 'Uploaded 12 files' },
          ],
        },
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { currentDeploymentId: deployment.id },
    });
  }

  console.log(`Seeded user ${user.email} with project ${project.slug}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
