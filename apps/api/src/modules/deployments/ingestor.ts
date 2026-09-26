import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  DEPLOYMENT_CHANNEL_PATTERN,
  deploymentChannel,
  workerEventSchema,
  type WorkerLogEvent,
} from '@osd/shared';
import type { DeploymentsRepository } from './deployments.repository.js';
import type { DeploymentsService } from './deployments.service.js';
import type { DeploymentHub } from './hub.js';
import { toLogDto } from './mappers.js';

export interface IngestorOptions {
  flushIntervalMs?: number;
  maxBatch?: number;
}

/**
 * Consumes worker events from Redis pub/sub (deployment:*), persists log lines in batches and
 * applies status changes. Work is serialized so a status change never lands before the log lines
 * published ahead of it.
 */
export class DeploymentEventIngestor {
  private buffer: WorkerLogEvent[] = [];
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;

  constructor(
    private readonly deps: {
      repo: DeploymentsRepository;
      service: DeploymentsService;
      hub: DeploymentHub;
      logger: Logger;
    },
    options: IngestorOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 250;
    this.maxBatch = options.maxBatch ?? 500;
  }

  /** `subscriber` must be a dedicated connection (it enters subscriber mode). */
  async start(subscriber: Redis): Promise<void> {
    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.handle(channel, message);
    });
    await subscriber.psubscribe(DEPLOYMENT_CHANNEL_PATTERN);
    this.timer = setInterval(() => this.enqueue(() => this.flush()), this.flushIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.drain();
  }

  /** Resolves once everything received so far is persisted. */
  async drain(): Promise<void> {
    this.enqueue(() => this.flush());
    await this.chain;
  }

  handle(channel: string, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.deps.logger.warn({ channel }, 'dropping malformed worker event');
      return;
    }
    const parsed = workerEventSchema.safeParse(json);
    if (!parsed.success || channel !== deploymentChannel(parsed.data.deploymentId)) {
      this.deps.logger.warn({ channel }, 'dropping invalid worker event');
      return;
    }
    const event = parsed.data;
    if (event.type === 'log') {
      this.buffer.push(event);
      if (this.buffer.length >= this.maxBatch) this.enqueue(() => this.flush());
      return;
    }
    this.enqueue(async () => {
      await this.flush();
      await this.deps.service.applyStatus(event.deploymentId, {
        status: event.status,
        at: new Date(event.ts),
        commitSha: event.commitSha,
        errorMessage: event.errorMessage,
      });
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((err: unknown) => {
      this.deps.logger.error({ err }, 'failed to ingest worker events');
    });
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    // Events for unknown deployments (deleted, or forged) are dropped instead of failing the batch.
    const known = await this.deps.repo.existingIds([...new Set(batch.map((e) => e.deploymentId))]);
    const rows = batch
      .filter((e) => known.has(e.deploymentId))
      .map((e) => ({
        deploymentId: e.deploymentId,
        ts: new Date(e.ts),
        level: e.level,
        message: e.message,
      }));
    if (rows.length === 0) return;

    const saved = await this.deps.repo.insertLogs(rows);
    this.deps.hub.emit('logs', saved.map(toLogDto));
  }
}
