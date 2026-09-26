import { PrismaClient, type Prisma } from '../generated/client/index.js';

export * from '../generated/client/index.js';

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
