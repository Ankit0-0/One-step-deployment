import type { Redis } from 'ioredis';
import {
  deploymentChannel,
  type DeploymentStatus,
  type LogLevel,
  type WorkerEvent,
} from '@osd/shared';

const MAX_MESSAGE_LENGTH = 8 * 1024;

export interface EventPublisher {
  log(level: LogLevel, message: string): Promise<void>;
  status(
    status: DeploymentStatus,
    extra?: { commitSha?: string; errorMessage?: string },
  ): Promise<void>;
}

export function truncate(message: string, max = MAX_MESSAGE_LENGTH): string {
  return message.length <= max ? message : `${message.slice(0, max - 15)}… [truncated]`;
}

/** Publishes worker events on the deployment's Redis channel. */
export class RedisEventPublisher implements EventPublisher {
  private readonly channel: string;

  constructor(
    private readonly redis: Redis,
    private readonly deploymentId: string,
  ) {
    this.channel = deploymentChannel(deploymentId);
  }

  private async publish(event: WorkerEvent): Promise<void> {
    await this.redis.publish(this.channel, JSON.stringify(event));
  }

  log(level: LogLevel, message: string): Promise<void> {
    return this.publish({
      type: 'log',
      deploymentId: this.deploymentId,
      ts: new Date().toISOString(),
      level,
      message: truncate(message),
    });
  }

  status(
    status: DeploymentStatus,
    extra: { commitSha?: string; errorMessage?: string } = {},
  ): Promise<void> {
    return this.publish({
      type: 'status',
      deploymentId: this.deploymentId,
      ts: new Date().toISOString(),
      status,
      ...(extra.commitSha && { commitSha: extra.commitSha }),
      ...(extra.errorMessage && { errorMessage: truncate(extra.errorMessage, 2000) }),
    });
  }
}
