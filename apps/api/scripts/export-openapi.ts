import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { applyGlobalPrefix } from '../src/app.setup';
import { buildOpenApiDocument } from '../src/swagger';

// Preview mode builds the module graph without instantiating providers,
// so no database, Redis or environment variables are needed (used in CI).
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  applyGlobalPrefix(app);
  const document = buildOpenApiDocument(app);
  const out = resolve(__dirname, '../openapi.json');
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write(`OpenAPI written to ${out}\n`);
}

void main();
