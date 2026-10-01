import { describe, expect, it } from 'vitest';
import { MemoryObjectStore } from '../src/object-store.js';

describe('MemoryObjectStore.deletePrefix', () => {
  const put = (store: MemoryObjectStore, key: string) =>
    store.put({ key, body: Buffer.from('x'), contentType: 'text/plain', contentLength: 1 });

  it('deletes only keys under the prefix', async () => {
    const store = new MemoryObjectStore();
    await put(store, 'deployments/aaaaaaaa/index.html');
    await put(store, 'deployments/aaaaaaaa/assets/app.js');
    await put(store, 'deployments/aaaaaaaab/index.html');
    expect(await store.deletePrefix('deployments/aaaaaaaa/')).toBe(2);
    expect([...store.objects.keys()]).toEqual(['deployments/aaaaaaaab/index.html']);
  });

  it('refuses an empty prefix', async () => {
    await expect(new MemoryObjectStore().deletePrefix('')).rejects.toThrow(/empty prefix/);
  });
});
