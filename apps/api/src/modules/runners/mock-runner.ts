import { deploymentChannel, type WorkerEvent } from '@osd/shared';
import { deploymentObjectKey, type ObjectStore } from '@osd/storage';
import type { BuildRunner, StartBuildInput } from './runner.js';

/** Where MockRunner sends worker events; the api's Redis client in production wiring. */
export interface EventSink {
  publish(channel: string, message: string): Promise<unknown>;
}

const SCRIPT: Array<{ level: 'info' | 'warn'; message: string }> = [
  { level: 'info', message: '$ npm ci' },
  { level: 'info', message: 'added 42 packages in 1s' },
  { level: 'warn', message: 'npm WARN deprecated example@1.0.0: simulated warning' },
  { level: 'info', message: '$ npm run build' },
  { level: 'info', message: '\u001b[32m✓\u001b[39m 3 modules transformed.' },
  { level: 'info', message: 'dist/index.html  0.40 kB' },
];

/**
 * Simulates a build without containers or git: publishes the same Redis events a real worker
 * would (so ingestion, persistence and socket.io run for real), then writes a one-page site.
 * For e2e tests and UI development only; config refuses it in production.
 */
export class MockRunner implements BuildRunner {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly deps: { sink: EventSink; store: ObjectStore; stepMs: number }) {}

  start(input: StartBuildInput): Promise<{ ref: string }> {
    const controller = new AbortController();
    this.running.set(input.deploymentId, controller);
    void this.run(input, controller.signal)
      .catch(() => this.status(input.deploymentId, 'FAILED', 'Simulated build crashed'))
      .catch(() => {})
      .finally(() => this.running.delete(input.deploymentId));
    return Promise.resolve({ ref: input.deploymentId });
  }

  stop(ref: string): Promise<void> {
    this.running.get(ref)?.abort();
    return Promise.resolve();
  }

  private async run(input: StartBuildInput, signal: AbortSignal): Promise<void> {
    const id = input.deploymentId;
    const step = () =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'));
        const timer = setTimeout(resolve, this.deps.stepMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });

    try {
      await step();
      await this.status(id, 'BUILDING');
      await this.log(id, 'info', `Cloning ${input.gitUrl} (simulated)`);
      for (const line of SCRIPT) {
        await step();
        await this.log(id, line.level, line.message);
      }
      await step();
      await this.status(id, 'UPLOADING');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Deployed</title></head><body><h1>Deployed ${id}</h1><p>Simulated build of ${escapeHtml(input.gitUrl)}</p></body></html>`;
      const body = Buffer.from(html);
      await this.deps.store.put({
        key: deploymentObjectKey(id, 'index.html'),
        body,
        contentType: 'text/html; charset=utf-8',
        contentLength: body.length,
      });
      await this.log(id, 'info', 'Uploading 1 files');
      await this.log(id, 'info', 'Deployment ready');
      await this.status(id, 'READY');
    } catch (err) {
      // Canceled: the api already moved the deployment to CANCELED.
      if (signal.aborted) return;
      throw err;
    }
  }

  private publish(event: WorkerEvent): Promise<unknown> {
    return this.deps.sink.publish(deploymentChannel(event.deploymentId), JSON.stringify(event));
  }

  private log(deploymentId: string, level: 'info' | 'warn', message: string) {
    return this.publish({
      type: 'log',
      deploymentId,
      ts: new Date().toISOString(),
      level,
      message,
    });
  }

  private status(
    deploymentId: string,
    status: 'BUILDING' | 'UPLOADING' | 'READY' | 'FAILED',
    errorMessage?: string,
  ) {
    return this.publish({
      type: 'status',
      deploymentId,
      ts: new Date().toISOString(),
      status,
      ...(errorMessage && { errorMessage }),
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
