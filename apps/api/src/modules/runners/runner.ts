export interface StartBuildInput {
  deploymentId: string;
  gitUrl: string;
  /** Propagated to the worker as REQUEST_ID for log correlation. */
  requestId: string;
}

/** Starts and stops build-worker runs. `ref` is whatever the runner needs to stop the run later. */
export interface BuildRunner {
  start(input: StartBuildInput): Promise<{ ref: string }>;
  stop(ref: string): Promise<void>;
}
