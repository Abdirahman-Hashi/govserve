import { Readable } from 'node:stream';
import { type StoragePort } from './storage.port';

/** Test adapter: objects live in a Map; "uploads" are done by calling `put`. */
export class InMemoryStorageAdapter implements StoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType = 'application/octet-stream'): void {
    this.objects.set(key, { body, contentType });
  }

  presignPut(input: {
    key: string;
    contentType: string;
  }): Promise<{ url: string; headers: Record<string, string> }> {
    return Promise.resolve({
      url: `https://storage.test/${input.key}?signed=1`,
      headers: { 'Content-Type': input.contentType },
    });
  }

  presignGet(input: { key: string }): Promise<string> {
    return Promise.resolve(`https://storage.test/${input.key}?download=1`);
  }

  head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
    const obj = this.objects.get(key);
    return Promise.resolve(obj ? { size: obj.body.length, contentType: obj.contentType } : null);
  }

  read(key: string, range?: { length: number }): Promise<Readable> {
    const obj = this.objects.get(key);
    if (!obj) return Promise.reject(new Error(`No such object: ${key}`));
    return Promise.resolve(Readable.from([range ? obj.body.subarray(0, range.length) : obj.body]));
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
