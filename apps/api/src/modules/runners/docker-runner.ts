import { request } from 'node:http';
import type { BuildRunner, StartBuildInput } from './runner.js';

export interface DockerApiResponse {
  status: number;
  body: string;
}

/** Minimal Docker Engine API transport (unix socket), injectable for tests. */
export type DockerApi = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<DockerApiResponse>;

export function dockerSocketApi(socketPath = '/var/run/docker.sock'): DockerApi {
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          socketPath,
          path: `/v1.43${path}`,
          method,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {},
          timeout: 30_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('Docker API timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
}

export interface DockerRunnerOptions {
  image: string;
  network?: string;
  /** e.g. "2g", "512m" */
  memory: string;
  /** e.g. "1", "0.5" */
  cpus: string;
  /** Static worker env (Redis, storage); per-build values are added on start. */
  workerEnv: Record<string, string>;
  api?: DockerApi;
}

export function parseMemory(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid memory limit: ${value}`);
  const units: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
  return Math.floor(Number(match[1]) * units[match[2]!.toLowerCase()]!);
}

/**
 * Local runner (BUILD_RUNNER=docker): one container per build via the Docker Engine API, with
 * resource limits, no capabilities and auto-removal. Dev and tests only; production uses ECS.
 */
export class DockerRunner implements BuildRunner {
  private readonly api: DockerApi;

  constructor(private readonly options: DockerRunnerOptions) {
    this.api = options.api ?? dockerSocketApi();
  }

  async start(input: StartBuildInput): Promise<{ ref: string }> {
    const env = {
      ...this.options.workerEnv,
      DEPLOYMENT_ID: input.deploymentId,
      GIT_URL: input.gitUrl,
      REQUEST_ID: input.requestId,
    };
    const name = `osd-build-${input.deploymentId}`;
    const created = await this.api('POST', `/containers/create?name=${encodeURIComponent(name)}`, {
      Image: this.options.image,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      Labels: { 'osd.deployment-id': input.deploymentId },
      HostConfig: {
        AutoRemove: true,
        Memory: parseMemory(this.options.memory),
        NanoCpus: Math.round(Number(this.options.cpus) * 1e9),
        PidsLimit: 1024,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        ...(this.options.network && { NetworkMode: this.options.network }),
      },
    });
    if (created.status !== 201)
      throw new Error(`docker create failed (${created.status}): ${created.body}`);
    const { Id: id } = JSON.parse(created.body) as { Id: string };

    const started = await this.api('POST', `/containers/${id}/start`);
    if (started.status !== 204 && started.status !== 304) {
      await this.api('DELETE', `/containers/${id}?force=true`).catch(() => {});
      throw new Error(`docker start failed (${started.status}): ${started.body}`);
    }
    return { ref: id };
  }

  async stop(ref: string): Promise<void> {
    if (!/^[0-9a-f]{12,64}$/.test(ref)) throw new Error('invalid container id');
    const res = await this.api('POST', `/containers/${ref}/stop?t=10`);
    // 304: already stopped; 404: already exited and auto-removed.
    if (res.status !== 204 && res.status !== 304 && res.status !== 404) {
      throw new Error(`docker stop failed (${res.status})`);
    }
  }
}
