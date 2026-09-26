import { PrismaClient, type Prisma } from '@prisma/client';

export * from '@prisma/client';

export interface CreatePrismaClientOptions {
  /** Defaults to DATABASE_URL from the environment. */
  url?: string;
  log?: Prisma.LogLevel[];
}

/** Each service creates one client at boot and disconnects on shutdown. */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(options.url && { datasources: { db: { url: options.url } } }),
    log: options.log ?? ['warn', 'error'],
  });
}
