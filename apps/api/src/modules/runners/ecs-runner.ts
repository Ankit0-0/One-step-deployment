import { RunTaskCommand, StopTaskCommand, type ECSClient } from '@aws-sdk/client-ecs';
import type { BuildRunner, StartBuildInput } from './runner.js';

export interface EcsRunnerOptions {
  cluster: string;
  taskDefinition: string;
  containerName: string;
  subnets: string[];
  securityGroups: string[];
  assignPublicIp: boolean;
  buildTimeoutMs: number;
}

/**
 * Production runner (BUILD_RUNNER=ecs): one Fargate task per build. Redis and bucket settings live
 * in the task definition; only per-build values are overridden here.
 */
export class EcsRunner implements BuildRunner {
  constructor(
    private readonly client: Pick<ECSClient, 'send'>,
    private readonly options: EcsRunnerOptions,
  ) {}

  async start(input: StartBuildInput): Promise<{ ref: string }> {
    const result = await this.client.send(
      new RunTaskCommand({
        cluster: this.options.cluster,
        taskDefinition: this.options.taskDefinition,
        launchType: 'FARGATE',
        count: 1,
        startedBy: 'osd-api',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: this.options.subnets,
            securityGroups: this.options.securityGroups,
            assignPublicIp: this.options.assignPublicIp ? 'ENABLED' : 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: this.options.containerName,
              environment: [
                { name: 'DEPLOYMENT_ID', value: input.deploymentId },
                { name: 'GIT_URL', value: input.gitUrl },
                { name: 'REQUEST_ID', value: input.requestId },
                { name: 'BUILD_TIMEOUT_MS', value: String(this.options.buildTimeoutMs) },
              ],
            },
          ],
        },
      }),
    );
    const arn = result.tasks?.[0]?.taskArn;
    if (!arn) {
      const reason = result.failures?.[0]?.reason ?? 'unknown';
      throw new Error(`ECS RunTask failed: ${reason}`);
    }
    return { ref: arn };
  }

  async stop(ref: string): Promise<void> {
    await this.client.send(
      new StopTaskCommand({ cluster: this.options.cluster, task: ref, reason: 'Canceled by user' }),
    );
  }
}
