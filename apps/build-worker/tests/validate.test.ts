import { describe, expect, it } from 'vitest';
import { InputError, validateBuildInput } from '../src/lib/validate.js';

const id = 'cm1abcdefghijklmnopqrstuv';

describe('validateBuildInput', () => {
  it('builds a canonical clone URL', () => {
    expect(validateBuildInput(id, 'https://github.com/vercel/next.js')).toEqual({
      deploymentId: id,
      cloneUrl: 'https://github.com/vercel/next.js.git',
    });
    expect(validateBuildInput(id, 'https://github.com/a/b.git').cloneUrl).toBe(
      'https://github.com/a/b.git',
    );
  });

  it.each([
    'https://github.com/a/b --upload-pack=touch /tmp/x',
    '--upload-pack=evil',
    'https://evil.com/a/b',
    'ssh://git@github.com/a/b',
    'https://github.com/a/b/../../c',
  ])('rejects git url %j', (url) => {
    expect(() => validateBuildInput(id, url)).toThrow(InputError);
  });

  it.each(['', '../etc', 'ID WITH SPACES', 'a/b', 'short'])('rejects deployment id %j', (bad) => {
    expect(() => validateBuildInput(bad, 'https://github.com/a/b')).toThrow(InputError);
  });
});
