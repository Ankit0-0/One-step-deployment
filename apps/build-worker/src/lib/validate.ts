import { parseGithubUrl } from '@osd/shared';
import { assertDeploymentId } from '@osd/storage';
import { BuildError } from './errors.js';

export interface BuildInput {
  deploymentId: string;
  /** Canonical clone URL rebuilt from the parsed owner/repo, never the raw input. */
  cloneUrl: string;
}

export class InputError extends BuildError {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export function validateBuildInput(deploymentId: string, gitUrl: string): BuildInput {
  try {
    assertDeploymentId(deploymentId);
  } catch {
    throw new InputError('Invalid DEPLOYMENT_ID');
  }
  const repo = parseGithubUrl(gitUrl);
  if (!repo) throw new InputError('GIT_URL must be https://github.com/<owner>/<repo>');
  return {
    deploymentId,
    cloneUrl: `https://github.com/${repo.owner}/${repo.repo}.git`,
  };
}
