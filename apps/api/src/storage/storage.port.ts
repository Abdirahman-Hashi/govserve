import { type Readable } from 'node:stream';

/** Private object storage (ADR-0004). Objects are never public; access is via short-lived URLs. */
export interface StoragePort {
  /** URL the browser PUTs to; the returned headers are signed and must be sent unchanged. */
  presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    headers: Record<string, string>;
  }>;
  presignGet(input: {
    key: string;
    expiresInSeconds: number;
    downloadName: string;
  }): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string | undefined } | null>;
  /** Streams the object (or its first `length` bytes). */
  read(key: string, range?: { length: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
