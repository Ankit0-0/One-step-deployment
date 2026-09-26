/** An error whose message is safe to show the user in the deployment log. */
export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}
