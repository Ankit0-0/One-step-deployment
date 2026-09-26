import { createReadStream } from 'node:fs';
import { contentTypeFor, deploymentObjectKey, type ObjectStore } from '@osd/storage';
import type { OutputFile } from '../lib/files.js';

export interface UploadPlanItem {
  file: OutputFile;
  key: string;
  contentType: string;
}

/** Map build output files to storage keys under deployments/{deploymentId}/. */
export function planUpload(deploymentId: string, files: readonly OutputFile[]): UploadPlanItem[] {
  return files.map((file) => ({
    file,
    key: deploymentObjectKey(deploymentId, file.relativePath),
    contentType: contentTypeFor(file.relativePath),
  }));
}

export async function uploadFiles(
  store: ObjectStore,
  plan: readonly UploadPlanItem[],
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const queue = [...plan];
  const workers = Array.from(
    { length: Math.min(options.concurrency ?? 8, queue.length) },
    async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (options.signal?.aborted) throw new Error('Upload canceled');
        await store.put({
          key: item.key,
          body: createReadStream(item.file.absolutePath),
          contentType: item.contentType,
          contentLength: item.file.size,
        });
      }
    },
  );
  await Promise.all(workers);
}
