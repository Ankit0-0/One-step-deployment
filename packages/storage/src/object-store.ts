import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { StorageEnv } from '@osd/config';

export interface StoredObject {
  body: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
}

export interface PutObjectInput {
  key: string;
  body: Readable | Buffer;
  contentType: string;
  contentLength: number;
  cacheControl?: string;
}

/** The storage operations the services need; S3 and MinIO both implement it via S3ObjectStore. */
export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(input: PutObjectInput): Promise<void>;
  /** Throws when the bucket is unreachable (used by /readyz). */
  ping(): Promise<void>;
}

export function createS3Client(env: StorageEnv, overrides: { endpoint?: string } = {}): S3Client {
  if (env.STORAGE_DRIVER === 'minio') {
    return new S3Client({
      region: env.S3_REGION,
      endpoint: overrides.endpoint ?? env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  // AWS: credentials come from the default provider chain (task role on ECS).
  return new S3Client({ region: env.AWS_REGION });
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromEnv(env: StorageEnv): S3ObjectStore {
    return new S3ObjectStore(createS3Client(env), env.STORAGE_BUCKET);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return {
        body: res.Body as Readable,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
        etag: res.ETag,
      };
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        CacheControl: input.cacheControl,
      }),
    );
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

/** In-memory store for tests and local tooling. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<
    string,
    { data: Buffer; contentType: string; cacheControl?: string }
  >();

  get(key: string): Promise<StoredObject | null> {
    const obj = this.objects.get(key);
    if (!obj) return Promise.resolve(null);
    return Promise.resolve({
      body: Readable.from([obj.data]),
      contentType: obj.contentType,
      contentLength: obj.data.length,
      etag: `"${obj.data.length}-${key.length}"`,
    });
  }

  async put(input: PutObjectInput): Promise<void> {
    let data: Buffer;
    if (Buffer.isBuffer(input.body)) {
      data = input.body;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) chunks.push(Buffer.from(chunk as Uint8Array));
      data = Buffer.concat(chunks);
    }
    this.objects.set(input.key, {
      data,
      contentType: input.contentType,
      cacheControl: input.cacheControl,
    });
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }
}
