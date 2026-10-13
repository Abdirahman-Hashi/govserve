import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { applyGlobalPrefix } from './app.setup';
import { buildOpenApiDocument } from './swagger';

export const LOCK_FILE = resolve(__dirname, '../openapi.lock');
export const CHANGELOG = resolve(__dirname, '../../../docs/API_CHANGELOG.md');

export interface OpenApiLock {
  version: string;
  sha256: string;
}

/** Builds the document without databases or credentials (Nest preview mode), as CI does. */
export async function buildContractDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  applyGlobalPrefix(app);
  const doc = buildOpenApiDocument(app);
  await app.close();
  return doc;
}

/** JSON with object keys sorted at every level, so the hash ignores key order only. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function specHash(doc: OpenAPIObject): string {
  return createHash('sha256').update(canonicalJson(doc)).digest('hex');
}

export function readLock(): OpenApiLock {
  return JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as OpenApiLock;
}

export function changelogHas(version: string): boolean {
  return new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(
    readFileSync(CHANGELOG, 'utf8'),
  );
}
