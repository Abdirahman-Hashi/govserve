import { type Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { type StoragePort } from './storage.port';

/** S3-compatible storage (RustFS locally, ADR-0007; any S3 in production). */
@Injectable()
export class S3StorageAdapter implements StoragePort, OnModuleDestroy {
  private readonly client: S3Client;
  /** Signs URLs for the host browsers can reach, which may differ from the internal endpoint. */
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const base = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      // Only add checksums when an operation requires them (some S3-compatible stores reject the extras).
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.publicClient = new S3Client({
      ...base,
      endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
    });
    this.bucket = config.S3_BUCKET;
  }

  async presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    // Signing the type and length means the store rejects any other file than the one declared.
    const url = await getSignedUrl(this.publicClient, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, headers: { 'Content-Type': input.contentType } };
  }

  presignGet(input: {
    key: string;
    expiresInSeconds: number;
    downloadName: string;
  }): Promise<string> {
    const safeName = input.downloadName.replace(/[^\w.\- ]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    });
    return getSignedUrl(this.publicClient, command, { expiresIn: input.expiresInSeconds });
  }

  async head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        (err.$metadata.httpStatusCode === 404 || err.name === 'NotFound')
      )
        return null;
      throw err;
    }
  }

  async read(key: string, range?: { length: number }): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range && { Range: `bytes=0-${range.length - 1}` }),
      }),
    );
    return res.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
    this.publicClient.destroy();
  }
}
