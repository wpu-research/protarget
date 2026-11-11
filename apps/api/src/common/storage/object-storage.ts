import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ApiError } from '../api-error';

export interface StoredObject { stream: Readable; size: number | null }

/** Creative binaries. Keys are server-generated; callers never pass user input as a key. */
export interface ObjectStorage {
  readonly driver: 'local' | 's3';
  put(key: string, sourcePath: string, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

const KEY = /^creatives\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
function checkKey(key: string) {
  if (!KEY.test(key)) throw new Error('Invalid storage key');
}

export class LocalDiskStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  constructor(private readonly root: string) {}
  private path(key: string) {
    checkKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, sourcePath: string, _contentType?: string) {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(createReadStream(sourcePath), createWriteStream(target, { flags: 'wx' }));
  }
  async get(key: string): Promise<StoredObject> {
    const target = this.path(key);
    const info = await stat(target).catch(() => null);
    if (!info) throw new ApiError(404, 'NOT_FOUND', 'Creative file not found');
    return { stream: createReadStream(target), size: info.size };
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export interface S3Settings {
  endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}
export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  /** The SDK's own retry cannot replay a consumed file stream, so it is off (maxAttempts 1) and `put` retries
   * itself with a fresh read stream per attempt. */
  constructor(private readonly settings: S3Settings, client?: S3Client, private readonly retryDelayMs = 250) {
    this.client = client ?? new S3Client({
      region: settings.region, endpoint: settings.endpoint, forcePathStyle: settings.forcePathStyle, maxAttempts: 1,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }
  async put(key: string, sourcePath: string, contentType: string) {
    checkKey(key);
    const { size } = await stat(sourcePath);
    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      const body = createReadStream(sourcePath);
      try {
        await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key,
          Body: body, ContentLength: size, ContentType: contentType }));
        return;
      } catch (error) {
        body.destroy();
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        // 4xx other than 429/408 (AccessDenied, NoSuchBucket, ...) will not heal by waiting.
        const permanent = status !== undefined && status >= 400 && status < 500 && status !== 429 && status !== 408;
        if (permanent || attempt >= attempts) throw error;
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }
  }
  async get(key: string): Promise<StoredObject> {
    checkKey(key);
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return { stream: out.Body as Readable, size: out.ContentLength ?? null };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') throw new ApiError(404, 'NOT_FOUND', 'Creative file not found');
      throw error;
    }
  }
  async delete(key: string) {
    checkKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }
}

export type StorageConfig =
  | { driver: 'disabled' }
  | { driver: 'local'; root: string }
  | { driver: 's3'; s3: S3Settings };

/** Only an explicit development/test NODE_ENV may fall back to the temp directory; an unset or any other
 * NODE_ENV (production, staging, typos) with no driver disables uploads (503) instead of using ephemeral disk. */
export function storageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const nodeEnv = env.NODE_ENV;
  const devLike = nodeEnv === 'development' || nodeEnv === 'test';
  const driver = env.STORAGE_DRIVER?.trim();
  const fail = (name: string): never => { throw new Error(`Invalid or missing ${name}`); };
  if (!driver) {
    return devLike ? { driver: 'local', root: join(tmpdir(), 'protarget-creatives') } : { driver: 'disabled' };
  }
  if (driver === 'local') {
    const root = env.STORAGE_LOCAL_DIR?.trim();
    if (!root || !root.startsWith('/')) fail('STORAGE_LOCAL_DIR');
    return { driver: 'local', root: root! };
  }
  if (driver === 's3') {
    const bucket = env.S3_BUCKET?.trim() || fail('S3_BUCKET');
    const accessKeyId = env.S3_ACCESS_KEY?.trim() || fail('S3_ACCESS_KEY');
    const secretAccessKey = env.S3_SECRET_KEY || fail('S3_SECRET_KEY');
    const endpoint = env.S3_ENDPOINT?.trim() || undefined;
    if (endpoint) {
      let url: URL;
      try { url = new URL(endpoint); } catch { return fail('S3_ENDPOINT'); }
      if (!['http:', 'https:'].includes(url.protocol) || (!devLike && url.protocol !== 'https:')) fail('S3_ENDPOINT');
    }
    return { driver: 's3', s3: { bucket, accessKeyId, secretAccessKey, endpoint,
      region: env.S3_REGION?.trim() || 'us-east-1', forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true' } };
  }
  return fail('STORAGE_DRIVER');
}

export function createStorage(config: StorageConfig): ObjectStorage | null {
  if (config.driver === 'local') return new LocalDiskStorage(config.root);
  if (config.driver === 's3') return new S3Storage(config.s3);
  return null;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
